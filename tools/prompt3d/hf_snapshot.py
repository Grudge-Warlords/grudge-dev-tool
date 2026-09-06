"""Allowlisted Hugging Face snapshot downloader for Prompt-to-3D installer.

The Electron main process supplies only repository, immutable revision and a
path-contained destination. No token is accepted and no generated code runs.
"""
import argparse
import hashlib
import json
from pathlib import Path
from huggingface_hub import snapshot_download


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--allow-pattern", action="append", default=[])
    args = parser.parse_args()
    destination = Path(args.destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    resolved = snapshot_download(
        repo_id=args.repo,
        revision=args.revision,
        local_dir=str(destination),
        local_dir_use_symlinks=False,
        resume_download=True,
        allow_patterns=args.allow_pattern or None,
        token=False,
    )
    files = []
    tree = hashlib.sha256()
    for path in sorted(destination.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(destination)
        if relative.as_posix() == ".grudge-snapshot.json" or relative.parts[0] == ".cache":
            continue
        if path.is_symlink():
            raise RuntimeError(f"model snapshot may not contain symlinks: {relative.as_posix()}")
        digest = hashlib.sha256()
        size = 0
        with path.open("rb") as handle:
            while chunk := handle.read(8 * 1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
        entry = {"path": relative.as_posix(), "bytes": size, "sha256": digest.hexdigest()}
        files.append(entry)
        tree.update(f"{entry['path']}\0{entry['bytes']}\0{entry['sha256']}\n".encode("utf-8"))
    metadata = {
        "ok": True,
        "repo": args.repo,
        "revision": args.revision,
        "path": resolved,
        "allowPatterns": args.allow_pattern,
        "fileCount": len(files),
        "installedBytes": sum(entry["bytes"] for entry in files),
        "treeSha256": tree.hexdigest(),
        "files": files,
    }
    (destination / ".grudge-snapshot.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata))


if __name__ == "__main__":
    main()
