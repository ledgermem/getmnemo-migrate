import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Adapter, SourceRecord } from "./adapters/base.js";
import { migrate, planMigration } from "./lib/migrator.js";

class MockAdapter extends Adapter {
  readonly name = "mock";
  private records: SourceRecord[];

  constructor(records: SourceRecord[]) {
    super({});
    this.records = records;
  }

  async count(): Promise<number | null> {
    return this.records.length;
  }

  async *iterate(): AsyncIterable<SourceRecord> {
    for (const r of this.records) yield r;
  }
}

class MockWriter {
  public calls: Array<{ content: string; metadata?: Record<string, unknown> }> = [];
  failOnce = false;
  async add(content: string, opts?: { metadata?: Record<string, unknown> }): Promise<unknown> {
    if (this.failOnce) {
      this.failOnce = false;
      throw new Error("transient");
    }
    this.calls.push({ content, metadata: opts?.metadata });
    return { id: `mem_${this.calls.length}` };
  }
}

const FIXTURE_RECORDS: SourceRecord[] = [
  { sourceId: "1", content: "first memory", metadata: { tag: "a" } },
  { sourceId: "2", content: "second memory", metadata: { tag: "b" } },
  { sourceId: "3", content: "third memory", metadata: { tag: "c" } },
];

describe("planMigration", () => {
  it("returns total + sample without writing", async () => {
    const adapter = new MockAdapter(FIXTURE_RECORDS);
    const plan = await planMigration(adapter, 2);
    expect(plan.total).toBe(3);
    expect(plan.sample).toHaveLength(2);
    expect(plan.sample[0]?.content).toBe("first memory");
  });
});

describe("migrate", () => {
  beforeEach(async () => {
    await fs.rm(join(homedir(), ".getmnemo", "migrations"), { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes every record to the writer with concurrency", async () => {
    const adapter = new MockAdapter(FIXTURE_RECORDS);
    const writer = new MockWriter();
    const progress: Array<{ written: number; failed: number }> = [];
    const job = await migrate(adapter, writer, {
      concurrency: 2,
      onProgress: (p) => progress.push({ written: p.written, failed: p.failed }),
    });

    expect(writer.calls).toHaveLength(3);
    expect(writer.calls.map((c) => c.content).sort()).toEqual([
      "first memory",
      "second memory",
      "third memory",
    ]);
    expect(job.status).toBe("completed");
    expect(job.written).toBe(3);
    expect(job.failed).toBe(0);
    expect(progress.length).toBeGreaterThan(0);
  });

  it("counts failures without aborting the run", async () => {
    const adapter = new MockAdapter(FIXTURE_RECORDS);
    const writer = new MockWriter();
    writer.failOnce = true;
    const job = await migrate(adapter, writer, { concurrency: 1 });
    expect(job.failed).toBe(1);
    expect(job.written).toBe(2);
    expect(job.status).toBe("completed");
  });

  it("preserves metadata on writes", async () => {
    const adapter = new MockAdapter([FIXTURE_RECORDS[0]!]);
    const writer = new MockWriter();
    await migrate(adapter, writer, { concurrency: 1 });
    expect(writer.calls[0]?.metadata).toEqual({ tag: "a" });
  });
});
