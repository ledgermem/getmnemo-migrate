import pLimit from "p-limit";
import { Adapter, SourceRecord } from "../adapters/index.js";
import { JobState, newJobId, writeJob, readJob, acquireSourceLock } from "./jobs.js";

export interface MemoryWriter {
  add(content: string, opts?: { metadata?: Record<string, unknown> }): Promise<unknown>;
}

export interface MigrateOptions {
  concurrency?: number;
  resumeJobId?: string;
  /** Called after every successful write or failure. */
  onProgress?: (state: { written: number; failed: number; total: number | null }) => void;
  /** Dry-run: count + sample, no writes. */
  plan?: boolean;
  /** Sample size when planning. */
  planSampleSize?: number;
}

export interface PlanResult {
  total: number | null;
  sample: SourceRecord[];
}

export async function planMigration(adapter: Adapter, sampleSize = 5): Promise<PlanResult> {
  const total = await adapter.count();
  const sample: SourceRecord[] = [];
  for await (const rec of adapter.iterate()) {
    sample.push(rec);
    if (sample.length >= sampleSize) break;
  }
  return { total, sample };
}

export async function migrate(
  adapter: Adapter,
  writer: MemoryWriter,
  opts: MigrateOptions = {},
): Promise<JobState> {
  const concurrency = Math.max(1, opts.concurrency ?? 5);

  // Hold an exclusive per-source lock for the lifetime of the run so two
  // operators can't kick off concurrent migrations against the same
  // provider and create duplicate memories.
  const releaseLock = await acquireSourceLock(adapter.name);

  let state: JobState;
  if (opts.resumeJobId) {
    state = await readJob(opts.resumeJobId);
    state.status = "running";
  } else {
    state = {
      id: newJobId(),
      source: adapter.name,
      status: "running",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      total: await adapter.count(),
      written: 0,
      failed: 0,
      processedIds: [],
    };
  }
  await writeJob(state);

  const seen = new Set(state.processedIds);
  const limit = pLimit(concurrency);
  const inflight: Promise<void>[] = [];
  let lastFlushAt = Date.now();

  const flush = async (): Promise<void> => {
    if (Date.now() - lastFlushAt < 500) return;
    lastFlushAt = Date.now();
    await writeJob(state);
  };

  try {
    for await (const rec of adapter.iterate()) {
      if (rec.sourceId && seen.has(rec.sourceId)) continue;
      const task = limit(async () => {
        try {
          await writer.add(rec.content, { metadata: rec.metadata ?? {} });
          state.written += 1;
          if (rec.sourceId) {
            state.processedIds.push(rec.sourceId);
            seen.add(rec.sourceId);
          }
        } catch (err) {
          state.failed += 1;
          state.lastError = err instanceof Error ? err.message : String(err);
        } finally {
          opts.onProgress?.({ written: state.written, failed: state.failed, total: state.total ?? null });
          await flush();
        }
      });
      inflight.push(task);
    }
    await Promise.all(inflight);
    state.status = "completed";
    state.finishedAt = new Date().toISOString();
  } catch (err) {
    // Wait for in-flight writes to finish before persisting the final
    // state — otherwise a successful write that lands AFTER the failure
    // checkpoint won't appear in `processedIds`, and a `--resume` run will
    // re-import the same record and create a duplicate memory.
    await Promise.allSettled(inflight);
    state.status = "failed";
    state.finishedAt = new Date().toISOString();
    state.lastError = err instanceof Error ? err.message : String(err);
    await writeJob(state);
    await releaseLock();
    throw err;
  }

  await writeJob(state);
  await releaseLock();
  return state;
}
