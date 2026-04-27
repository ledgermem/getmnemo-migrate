import { Adapter, AdapterConfig, SourceRecord } from "./base.js";

interface SuperMemoryItem {
  id?: string;
  content?: string;
  text?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

interface SuperMemoryPage {
  results?: SuperMemoryItem[];
  total?: number;
  nextCursor?: string | null;
}

const DEFAULT_BASE_URL = "https://api.supermemory.ai";

export class SupermemoryAdapter extends Adapter {
  readonly name = "supermemory";

  private apiKey: string;
  private baseUrl: string;

  constructor(cfg: AdapterConfig = {}) {
    super(cfg);
    const key = process.env.SUPERMEMORY_API_KEY;
    if (!key) {
      throw new Error("SUPERMEMORY_API_KEY is required for the supermemory adapter");
    }
    this.apiKey = key;
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private async request(path: string): Promise<SuperMemoryPage> {
    const res = await fetch(new URL(path, this.baseUrl + "/"), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`supermemory request failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as SuperMemoryPage;
  }

  async count(): Promise<number | null> {
    const page = await this.request("/v3/memories?limit=1");
    return typeof page.total === "number" ? page.total : null;
  }

  async *iterate(): AsyncIterable<SourceRecord> {
    const pageSize = this.cfg.pageSize ?? 100;
    let cursor: string | null = null;
    do {
      const path = `/v3/memories?limit=${pageSize}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = await this.request(path);
      for (const item of page.results ?? []) {
        const content = item.content ?? item.text;
        if (!content) continue;
        yield {
          sourceId: item.id,
          content,
          metadata: {
            source: "supermemory",
            ...(item.type ? { type: item.type } : {}),
            ...(item.createdAt ? { sourceCreatedAt: item.createdAt } : {}),
            ...(item.metadata ?? {}),
          },
        };
      }
      cursor = page.nextCursor ?? null;
    } while (cursor);
  }
}
