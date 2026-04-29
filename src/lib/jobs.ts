import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

export type JobStatus = "running" | "completed" | "failed" | "paused";

export interface JobState {
  id: string;
  source: string;
  status: JobStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  total?: number | null;
  written: number;
  failed: number;
  /** Provider-native ids that have been successfully written. Used to skip on resume. */
  processedIds: string[];
  lastError?: string;
}

const JOB_DIR = join(homedir(), ".getmnemo", "migrations");

export function jobsDir(): string {
  return JOB_DIR;
}

export function jobPath(id: string): string {
  return join(JOB_DIR, `${id}.json`);
}

export function newJobId(): string {
  return `mig_${randomUUID()}`;
}

export async function readJob(id: string): Promise<JobState> {
  const raw = await fs.readFile(jobPath(id), "utf8");
  return JSON.parse(raw) as JobState;
}

export async function writeJob(state: JobState): Promise<void> {
  const path = jobPath(state.id);
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const next: JobState = { ...state, updatedAt: new Date().toISOString() };
  // Atomic write: write to a temp file in the same directory, then rename.
  // Without this, a crash mid-write leaves a half-written JSON file that
  // makes the job impossible to resume.
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(tmp, path);
}

/**
 * Acquire an exclusive lock for `source` so two concurrent invocations of
 * the migrator on the same provider can't double-import the same records.
 * The lock is implemented via `O_EXCL | O_CREAT` on a per-source file —
 * `fs.open` with `wx` flag rejects when the file exists. The PID is written
 * for diagnostics. Returns a release function.
 *
 * Without this guard, two operators each running `getmnemo-migrate from
 * mem0 --user u123` produce overlapping writes: each task list filters by
 * its own `seen` set, but the OTHER process has no view of those ids and
 * happily re-imports the same record, creating duplicate memories.
 */
export async function acquireSourceLock(source: string): Promise<() => Promise<void>> {
  const safe = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const lockPath = join(JOB_DIR, `${safe}.lock`);
  await fs.mkdir(JOB_DIR, { recursive: true, mode: 0o700 });
  try {
    const handle = await fs.open(lockPath, "wx", 0o600);
    await handle.writeFile(`${process.pid}\n`);
    await handle.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `another migration is already running for source "${source}" (lock at ${lockPath}). ` +
          `If you are sure no other process is running, remove the lock file.`,
      );
    }
    throw err;
  }
  return async () => {
    try {
      await fs.unlink(lockPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  };
}

export async function listJobs(): Promise<JobState[]> {
  try {
    const files = await fs.readdir(JOB_DIR);
    const jobs = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => JSON.parse(await fs.readFile(join(JOB_DIR, f), "utf8")) as JobState),
    );
    return jobs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
