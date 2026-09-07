"""Loopback-only Prompt-to-3D job sidecar with bounded, cancellable jobs."""
import argparse
import json
import os
import re
import secrets
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=0)
parser.add_argument("--root", required=True)
parser.add_argument("--worker", required=True)
args = parser.parse_args()
ROOT, WORKER = Path(args.root).resolve(), Path(args.worker).resolve()
TOKEN = os.environ.get("GRUDGE_PROMPT3D_SIDECAR_TOKEN") or secrets.token_urlsafe(32)
jobs, lock = {}, threading.Lock()


def contained(path: str) -> Path:
    p = Path(path).resolve()
    if ROOT != p and ROOT not in p.parents:
        raise ValueError("path escapes task root")
    return p


def redact(value: str) -> str:
    value = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", value)
    value = re.sub(r"(?i)(token|authorization|api[_-]?key)\s*[=:]\s*\S+", r"\1=[redacted]", value)
    value = re.sub(r"/home/[^/\s]+", "/home/[redacted-user]", value)
    value = re.sub(r"C:\\Users\\[^\\\s]+", lambda _match: r"C:\Users\[redacted-user]", value, flags=re.IGNORECASE)
    return value[:1000]


def wsl_path(path: Path) -> str:
    raw = str(path).replace("\\", "/")
    if len(raw) > 2 and raw[1] == ":":
        return f"/mnt/{raw[0].lower()}{raw[2:]}"
    raise ValueError("TRELLIS task paths must be on a mounted Windows drive")


def run_job(job_id: str, provider: str, spec_path: Path, output: Path, python: str | None, wsl_distro: str | None, provider_root_name: str | None):
    launcher_path = None
    try:
        pid_file = contained(str(output.parent / ".provider-worker.pid"))
        selected_worker = WORKER.parent / "hy_motion_worker.py" if provider == "hy-motion-1" else WORKER
        if not selected_worker.is_file():
            raise ValueError("typed provider worker is missing")
        if wsl_distro:
            expected_prefix = "trellis-" if provider == "trellis" else "hy-motion-1-" if provider == "hy-motion-1" else "hunyuan3d-2-"
            if not re.fullmatch(r"[A-Za-z0-9._ -]{1,80}", wsl_distro) or not provider_root_name or not provider_root_name.startswith(expected_prefix):
                raise ValueError("Invalid typed WSL provider configuration")
            provider_source = wsl_path(ROOT / provider / "source")
            launcher_arguments = [
                provider_root_name, wsl_path(selected_worker), "--provider", provider,
                "--spec", wsl_path(spec_path), "--root", wsl_path(ROOT),
                "--output", wsl_path(output), "--provider-source", provider_source,
                "--pid-file", wsl_path(pid_file),
            ]
            launcher_path = contained(str(output.parent / ".provider-worker.sh"))
            launcher_path.write_text(
                "#!/usr/bin/env bash\n"
                "set -e\n"
                "export PYTHONDONTWRITEBYTECODE=1\n"
                'provider_root_name="$1"\n'
                "shift\n"
                'provider_environment="$HOME/.local/share/grudge-prompt3d/$provider_root_name/environment"\n'
                'export PATH="$provider_environment/bin:$PATH"\n'
                'export LD_LIBRARY_PATH="$provider_environment/lib:$provider_environment/lib64:${LD_LIBRARY_PATH:-}"\n'
                'exec "$provider_environment/bin/python" "$@"\n',
                encoding="utf-8", newline="\n",
            )
            cmd = ["wsl.exe", "-d", wsl_distro, "--exec", "bash", wsl_path(launcher_path), *launcher_arguments]
        else:
            if not python:
                raise ValueError("Local Python path required")
            cmd = [python, str(selected_worker), "--provider", provider, "--spec", str(spec_path), "--root", str(ROOT), "--output", str(output), "--pid-file", str(pid_file)]
        worker_env = {**os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "PYTHONDONTWRITEBYTECODE": "1"}
        worker_env.pop("GRUDGE_PROMPT3D_SIDECAR_TOKEN", None)
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", env=worker_env)
        with lock:
            cancelled_before_start = jobs[job_id].get("state") == "cancelled"
            jobs[job_id].update({"process": proc, "pid_file": str(pid_file), "wsl_distro": wsl_distro})
        if cancelled_before_start:
            proc.terminate()
        for line in proc.stdout or []:
            try:
                event = json.loads(line)
                with lock:
                    timing = event.get("timing")
                    if isinstance(timing, dict) and isinstance(timing.get("stage"), str):
                        timings = jobs[job_id].setdefault("timings", [])
                        identity = (timing.get("stage"), timing.get("startedAt"))
                        if not any((item.get("stage"), item.get("startedAt")) == identity for item in timings if isinstance(item, dict)):
                            timings.append(timing)
                    jobs[job_id].update({key: value for key, value in event.items() if key != "timing" and (key != "message" or value)})
            except Exception:
                with lock:
                    diagnostic = redact(line.strip())
                    if diagnostic:
                        jobs[job_id]["message"] = diagnostic
                        jobs[job_id]["_diagnostics"] = (jobs[job_id].get("_diagnostics", []) + [diagnostic])[-20:]
        code = proc.wait()
        with lock:
            was_cancelled = jobs[job_id].get("state") == "cancelled"
            diagnostics = jobs[job_id].get("_diagnostics", [])
            diagnostic_summary = " | ".join(diagnostics)[-4_000:] if diagnostics else "no diagnostic was emitted"
            error = None if code == 0 or was_cancelled else f"Provider worker exited {code}: {diagnostic_summary}"
            if code != 0 and not was_cancelled and jobs[job_id].get("errorCode") == "CONCEPT_REVIEW_REQUIRED":
                error = "CONCEPT_REVIEW_REQUIRED: " + jobs[job_id].get("reviewMessage", "Inspect the saved concept before generating geometry.")
            state = "cancelled" if was_cancelled else "complete" if code == 0 else "failed"
            pending_approval = jobs[job_id].get("stage") == "awaiting-concept-approval"
            message = "Cancellation completed for the task-owned provider worker." if was_cancelled else "Concept retained; explicit approval is required before geometry." if code == 0 and pending_approval else "Provider output complete." if code == 0 else error
            jobs[job_id].update({"state": state, "stage": "cancelled" if was_cancelled else jobs[job_id].get("stage", "failed"), "progress": 35 if code == 0 and pending_approval else 90 if code == 0 else jobs[job_id].get("progress", 0), "output": str(output) if code == 0 and not pending_approval else None, "error": error, "message": message})
            for internal in ("process", "pid_file", "wsl_distro", "_diagnostics"):
                jobs[job_id].pop(internal, None)
    except Exception as error:
        with lock:
            jobs[job_id].update({"state": "failed", "error": str(error), "message": "Provider worker could not start."})
            for internal in ("process", "pid_file", "wsl_distro"):
                jobs[job_id].pop(internal, None)
    finally:
        if launcher_path:
            launcher_path.unlink(missing_ok=True)


def cancel_process(job: dict) -> bool:
    """Stop only the typed worker process; never terminate the distribution."""
    proc = job.get("process")
    distro = job.get("wsl_distro")
    pid_file_raw = job.get("pid_file")
    signalled = False
    if distro and pid_file_raw:
        try:
            pid_file = contained(pid_file_raw)
            pid_text = pid_file.read_text(encoding="ascii").strip()
            if not re.fullmatch(r"[1-9][0-9]{0,9}", pid_text):
                raise ValueError("invalid provider worker pid")
            result = subprocess.run(
                ["wsl.exe", "-d", distro, "--exec", "/bin/kill", "-TERM", pid_text],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=8, check=False,
            )
            signalled = result.returncode == 0
        except Exception:
            signalled = False
    if proc and proc.poll() is None:
        proc.terminate()
        signalled = True
    return signalled


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        return

    def reply(self, code, payload):
        data = json.dumps(payload).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def authorized(self):
        return secrets.compare_digest(self.headers.get("Authorization", ""), f"Bearer {TOKEN}")

    def do_GET(self):
        if not self.authorized(): return self.reply(403, {"error": "forbidden"})
        if self.path == "/health": return self.reply(200, {"ok": True, "binding": "127.0.0.1", "concurrency": 1})
        if self.path == "/capabilities": return self.reply(200, {"providers": ["hunyuan3d-2", "trellis", "hy-motion-1"], "operations": ["health", "capabilities", "start", "progress", "cancel", "result", "error"]})
        if self.path.startswith("/jobs/"):
            job_id = self.path.rsplit("/", 1)[-1]
            with lock:
                job = dict(jobs.get(job_id, {}))
                for internal in ("process", "pid_file", "wsl_distro", "_diagnostics"):
                    job.pop(internal, None)
            return self.reply(200 if job else 404, job or {"error": "not found"})
        return self.reply(404, {"error": "not found"})

    def do_POST(self):
        if not self.authorized(): return self.reply(403, {"error": "forbidden"})
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length < 0 or content_length > 1_000_000:
            return self.reply(413, {"error": "request body exceeds limit"})
        body = json.loads(self.rfile.read(content_length) or b"{}")
        if self.path == "/jobs":
            job_id, provider = str(body["jobId"]), str(body["providerId"])
            if not re.fullmatch(r"[0-9a-f-]{36}-[1-4]", job_id): return self.reply(400, {"error": "invalid typed job id"})
            if provider not in ("hunyuan3d-2", "trellis", "hy-motion-1"): return self.reply(400, {"error": "provider not allowlisted"})
            spec_path, output = contained(body["specPath"]), contained(body["output"])
            wsl_distro = str(body.get("wslDistro") or "") or None
            python = contained(body["python"]) if provider == "hunyuan3d-2" and not wsl_distro else None
            provider_root_name = str(body.get("providerRootName") or "") or None
            with lock:
                if any(j.get("state") == "running" for j in jobs.values()): return self.reply(429, {"error": "bounded concurrency reached"})
                jobs[job_id] = {"id": job_id, "state": "running", "stage": "queued", "progress": 0, "message": "Provider worker starting.", "timings": []}
            threading.Thread(target=run_job, args=(job_id, provider, spec_path, output, str(python) if python else None, wsl_distro, provider_root_name), daemon=True).start()
            return self.reply(202, {"id": job_id, "state": "running"})
        if self.path.endswith("/cancel"):
            job_id = self.path.split("/")[-2]
            with lock:
                job = jobs.get(job_id)
            signalled = cancel_process(job) if job else False
            with lock:
                if job: job.update({"state": "cancelled", "stage": "cancelled", "message": "Cancellation signal sent to the task-owned provider worker." if signalled else "Job was already stopping."})
            return self.reply(200, {"ok": bool(job)})
        return self.reply(404, {"error": "not found"})


server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
print(json.dumps({"port": server.server_port, "host": "127.0.0.1"}), flush=True)
server.serve_forever()
