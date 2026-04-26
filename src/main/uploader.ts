import { promises as fs } from "node:fs";
import { basename } from "node:path";
import { EventEmitter } from "node:events";
import { requestUploadUrl } from "./api";
import type { UploadJob, UploadProgress } from "../shared/ipc";

const CONCURRENCY = 4;
const MAX_RETRIES = 3;

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function putWithRetry(url: string, body: Buffer, contentType: string): Promise<void> {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body,
      });
      if (resp.ok) return;
      lastErr = new Error(`PUT ${resp.status} ${resp.statusText}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(250 * Math.pow(2, attempt - 1));
  }
  throw lastErr ?? new Error("upload failed");
}

export class UploadQueue extends EventEmitter {
  private jobs = new Map<string, UploadJob>();

  enqueue(job: UploadJob): void {
    this.jobs.set(job.id, job);
    this.run(job).catch((err) => {
      console.error(`[uploader] job ${job.id} crashed`, err);
    });
  }

  cancel(jobId: string): boolean {
    return this.jobs.delete(jobId);
  }

  private async run(job: UploadJob): Promise<void> {
    const queue = job.files.map((file, idx) => ({ idx, file }));
    const workers: Promise<void>[] = [];

    const next = async () => {
      while (this.jobs.has(job.id)) {
        const item = queue.shift();
        if (!item) return;
        const { idx, file } = item;

        const stat = await fs.stat(file.localPath).catch(() => null);
        if (!stat) {
          this.emitProgress({
            jobId: job.id, fileIndex: idx, filePath: file.localPath,
            status: "failed", bytesUploaded: 0, bytesTotal: 0,
            error: "file not found",
          });
          continue;
        }

        this.emitProgress({
          jobId: job.id, fileIndex: idx, filePath: file.localPath,
          status: "uploading", bytesUploaded: 0, bytesTotal: stat.size,
        });

        try {
          const ticket = await requestUploadUrl({
            path: file.targetPath,
            contentType: file.contentType,
            size: stat.size,
          });
          const data = await fs.readFile(file.localPath);
          await putWithRetry(ticket.uploadURL, data, file.contentType ?? "application/octet-stream");
          this.emitProgress({
            jobId: job.id, fileIndex: idx, filePath: file.localPath,
            status: "completed", bytesUploaded: stat.size, bytesTotal: stat.size,
          });
        } catch (err: any) {
          // 409 = duplicate, treat as skipped
          const isDup = String(err?.message || "").includes("409");
          this.emitProgress({
            jobId: job.id, fileIndex: idx, filePath: file.localPath,
            status: isDup ? "skipped" : "failed",
            bytesUploaded: 0, bytesTotal: stat.size,
            error: err?.message ?? String(err),
          });
        }
      }
    };

    for (let i = 0; i < CONCURRENCY; i++) workers.push(next());
    await Promise.all(workers);
    this.emit("job:done", { jobId: job.id });
    this.jobs.delete(job.id);
  }

  private emitProgress(p: UploadProgress) {
    this.emit("progress", p);
  }
}

export const uploader = new UploadQueue();
