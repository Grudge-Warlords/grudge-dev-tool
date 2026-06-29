import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";
import { EventEmitter } from "node:events";
import { requestUploadUrl, writeManifest } from "./api";
import { ingestOne, type IngestEntry } from "./ingestion";
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

async function uploadFile(
  localPath: string,
  targetPath: string,
  contentType?: string,
): Promise<void> {
  const stat = await fs.stat(localPath);
  const ticket = await requestUploadUrl({
    path: targetPath,
    contentType,
    size: stat.size,
  });
  const data = await fs.readFile(localPath);
  await putWithRetry(ticket.uploadURL, data, contentType ?? "application/octet-stream");
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
    const manifestEntries: Array<{
      path: string;
      grudgeUUID: string;
      sha256: string;
      sizeBytes: number;
      contentType: string;
      category?: string;
    }> = [];

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
          let uploads: Array<{ localPath: string; targetPath: string; contentType?: string }> = [{
            localPath: file.localPath,
            targetPath: file.targetPath,
            contentType: file.contentType,
          }];

          if (job.runPipeline) {
            this.emitProgress({
              jobId: job.id, fileIndex: idx, filePath: file.localPath,
              status: "uploading", bytesUploaded: 0, bytesTotal: stat.size,
              error: "pipeline: size-verify → convert → enrich → rig",
            });
            const entry: IngestEntry = await ingestOne(file.localPath, {
              category: job.category,
              packId: job.packId,
              packVersion: job.packVersion,
              itemId: idx + 1,
              makeThumbnail: true,
              skipEnrich: true,
            });
            if (!entry.ok) {
              throw new Error(entry.errors.join("; ") || "ingestion failed");
            }
            const baseDir = dirname(file.targetPath);
            const outName = basename(entry.outputPath);
            uploads = [{
              localPath: entry.outputPath,
              targetPath: `${baseDir}/${outName}`,
              contentType: entry.contentType,
            }];
            for (const c of entry.companions) {
              uploads.push({
                localPath: c.path,
                targetPath: `${baseDir}/${basename(c.path)}`,
              });
            }
            if (entry.thumbnailPath) {
              uploads.push({
                localPath: entry.thumbnailPath,
                targetPath: `${baseDir}/${basename(entry.thumbnailPath)}`,
              });
            }
            if (job.buildManifest) {
              manifestEntries.push({
                path: uploads[0].targetPath,
                grudgeUUID: entry.grudgeUUID,
                sha256: entry.sha256,
                sizeBytes: entry.sizeBytes,
                contentType: entry.contentType,
                category: entry.category ?? job.category,
              });
            }
          }

          for (const u of uploads) {
            await uploadFile(u.localPath, u.targetPath, u.contentType);
          }

          this.emitProgress({
            jobId: job.id, fileIndex: idx, filePath: file.localPath,
            status: "completed", bytesUploaded: stat.size, bytesTotal: stat.size,
          });
        } catch (err: any) {
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

    const workers: Promise<void>[] = [];
    for (let i = 0; i < CONCURRENCY; i++) workers.push(next());
    await Promise.all(workers);

    if (job.buildManifest && manifestEntries.length > 0 && job.packId) {
      try {
        await writeManifest({
          packId: job.packId,
          version: job.packVersion ?? "0.0.0",
          entries: manifestEntries,
        });
      } catch (err) {
        console.error("[uploader] manifest write failed", err);
      }
    }

    this.emit("job:done", { jobId: job.id });
    this.jobs.delete(job.id);
  }

  private emitProgress(p: UploadProgress) {
    this.emit("progress", p);
  }
}

export const uploader = new UploadQueue();