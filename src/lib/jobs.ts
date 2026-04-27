import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

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

const JOB_DIR = join(homedir(), ".ledgermem", "migrations");

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
  await fs.writeFile(path, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
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
