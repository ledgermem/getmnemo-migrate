import { createReadStream, promises as fs } from "node:fs";
import { createInterface } from "node:readline";
import { Adapter, AdapterConfig, SourceRecord } from "./base.js";

type FieldMap = Record<string, string>;

function parseMap(spec: string | undefined): FieldMap {
  if (!spec) return { content: "content", id: "id" };
  const out: FieldMap = {};
  for (const part of spec.split(",")) {
    const [target, source] = part.split("=");
    if (!target || !source) continue;
    out[target.trim()] = source.trim();
  }
  if (!out.content) out.content = "content";
  if (!out.id) out.id = "id";
  return out;
}

function pluck(obj: Record<string, unknown>, key: string): unknown {
  if (!key.includes(".")) return obj[key];
  let cur: unknown = obj;
  for (const seg of key.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export class RawJsonlAdapter extends Adapter {
  readonly name = "raw-jsonl";

  private filePath: string;
  private map: FieldMap;

  constructor(cfg: AdapterConfig = {}) {
    super(cfg);
    if (!cfg.file) {
      throw new Error("--file <path.jsonl> is required for the raw-jsonl adapter");
    }
    this.filePath = cfg.file;
    this.map = parseMap(cfg.map);
  }

  async count(): Promise<number | null> {
    try {
      const data = await fs.readFile(this.filePath, "utf8");
      return data.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
    } catch {
      return null;
    }
  }

  async *iterate(): AsyncIterable<SourceRecord> {
    const stream = createReadStream(this.filePath, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNo = 0;
    for await (const line of rl) {
      lineNo += 1;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch (err) {
        throw new Error(`Invalid JSON on line ${lineNo} of ${this.filePath}: ${(err as Error).message}`);
      }
      const content = pluck(parsed, this.map.content!);
      if (typeof content !== "string" || content.length === 0) continue;
      const id = pluck(parsed, this.map.id!);
      const metadata: Record<string, unknown> = { source: "raw-jsonl", file: this.filePath };
      for (const [target, source] of Object.entries(this.map)) {
        if (target === "content" || target === "id") continue;
        const v = pluck(parsed, source);
        if (v !== undefined) metadata[target] = v;
      }
      yield {
        sourceId: typeof id === "string" || typeof id === "number" ? String(id) : undefined,
        content,
        metadata,
      };
    }
  }
}
