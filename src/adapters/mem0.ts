import { Adapter, AdapterConfig, SourceRecord } from "./base.js";

interface Mem0Memory {
  id?: string;
  memory?: string;
  text?: string;
  user_id?: string;
  agent_id?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

interface Mem0Page {
  results?: Mem0Memory[];
  next?: string | null;
  count?: number;
}

const DEFAULT_BASE_URL = "https://api.mem0.ai";

export class Mem0Adapter extends Adapter {
  readonly name = "mem0";

  private apiKey: string;
  private baseUrl: string;

  constructor(cfg: AdapterConfig = {}) {
    super(cfg);
    const key = process.env.MEM0_API_KEY;
    if (!key) {
      throw new Error("MEM0_API_KEY is required for the mem0 adapter");
    }
    this.apiKey = key;
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private async request(path: string): Promise<Mem0Page> {
    const res = await fetch(new URL(path, this.baseUrl + "/"), {
      headers: {
        Authorization: `Token ${this.apiKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`mem0 request failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as Mem0Page;
  }

  async count(): Promise<number | null> {
    const params = new URLSearchParams({ page: "1", page_size: "1" });
    if (this.cfg.user) params.set("user_id", this.cfg.user);
    const page = await this.request(`/v1/memories/?${params.toString()}`);
    return typeof page.count === "number" ? page.count : null;
  }

  async *iterate(): AsyncIterable<SourceRecord> {
    const pageSize = this.cfg.pageSize ?? 100;
    let nextUrl: string | null = `/v1/memories/?page_size=${pageSize}${
      this.cfg.user ? `&user_id=${encodeURIComponent(this.cfg.user)}` : ""
    }`;
    while (nextUrl) {
      const page = await this.request(nextUrl);
      const results = page.results ?? [];
      for (const m of results) {
        const content = m.memory ?? m.text;
        if (!content) continue;
        yield {
          sourceId: m.id,
          content,
          metadata: {
            source: "mem0",
            ...(m.user_id ? { userId: m.user_id } : {}),
            ...(m.agent_id ? { agentId: m.agent_id } : {}),
            ...(m.created_at ? { sourceCreatedAt: m.created_at } : {}),
            ...(m.metadata ?? {}),
          },
        };
      }
      nextUrl = page.next ? page.next.replace(this.baseUrl, "") : null;
    }
  }
}
