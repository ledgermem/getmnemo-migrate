import { Adapter, AdapterConfig } from "./base.js";
import { Mem0Adapter } from "./mem0.js";
import { ZepAdapter } from "./zep.js";
import { SupermemoryAdapter } from "./supermemory.js";
import { LettaAdapter } from "./letta.js";
import { RawJsonlAdapter } from "./raw-jsonl.js";

export type AdapterName = "mem0" | "zep" | "supermemory" | "letta" | "raw-jsonl";

export const ADAPTER_NAMES: AdapterName[] = ["mem0", "zep", "supermemory", "letta", "raw-jsonl"];

export function createAdapter(name: string, cfg: AdapterConfig = {}): Adapter {
  switch (name) {
    case "mem0":
      return new Mem0Adapter(cfg);
    case "zep":
      return new ZepAdapter(cfg);
    case "supermemory":
      return new SupermemoryAdapter(cfg);
    case "letta":
      return new LettaAdapter(cfg);
    case "raw-jsonl":
      return new RawJsonlAdapter(cfg);
    default:
      throw new Error(`Unknown adapter "${name}". Valid: ${ADAPTER_NAMES.join(", ")}`);
  }
}

export { Adapter };
export type { AdapterConfig, SourceRecord } from "./base.js";
