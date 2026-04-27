import { Adapter, AdapterConfig, SourceRecord } from "./base.js";

interface LettaBlock {
  id?: string;
  label?: string;
  value?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

interface LettaArchivalMemory {
  id?: string;
  text?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

interface LettaAgent {
  id?: string;
  name?: string;
  memory?: { blocks?: LettaBlock[] };
}

export class LettaAdapter extends Adapter {
  readonly name = "letta";

  private apiKey: string;
  private baseUrl: string;

  constructor(cfg: AdapterConfig = {}) {
    super(cfg);
    const key = process.env.LETTA_API_KEY;
    const baseUrl = process.env.LETTA_BASE_URL ?? cfg.baseUrl;
    if (!key) {
      throw new Error("LETTA_API_KEY is required for the letta adapter");
    }
    if (!baseUrl) {
      throw new Error("LETTA_BASE_URL is required for the letta adapter");
    }
    this.apiKey = key;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl + "/"), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`letta request failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  async count(): Promise<number | null> {
    return null;
  }

  async *iterate(): AsyncIterable<SourceRecord> {
    const agents = await this.request<LettaAgent[]>("/v1/agents/");
    for (const agent of agents) {
      const agentId = agent.id;
      if (!agentId) continue;

      // Core memory blocks
      for (const block of agent.memory?.blocks ?? []) {
        if (!block.value) continue;
        yield {
          sourceId: block.id,
          content: block.value,
          metadata: {
            source: "letta",
            kind: "core_block",
            agentId,
            ...(agent.name ? { agentName: agent.name } : {}),
            ...(block.label ? { label: block.label } : {}),
            ...(block.created_at ? { sourceCreatedAt: block.created_at } : {}),
            ...(block.metadata ?? {}),
          },
        };
      }

      // Archival memory (paginated by `after` cursor)
      const pageSize = this.cfg.pageSize ?? 100;
      let after: string | undefined;
      while (true) {
        const path = `/v1/agents/${encodeURIComponent(agentId)}/archival-memory?limit=${pageSize}${
          after ? `&after=${encodeURIComponent(after)}` : ""
        }`;
        const page = await this.request<LettaArchivalMemory[]>(path);
        if (!page || page.length === 0) break;
        for (const m of page) {
          if (!m.text) continue;
          yield {
            sourceId: m.id,
            content: m.text,
            metadata: {
              source: "letta",
              kind: "archival",
              agentId,
              ...(agent.name ? { agentName: agent.name } : {}),
              ...(m.created_at ? { sourceCreatedAt: m.created_at } : {}),
              ...(m.metadata ?? {}),
            },
          };
        }
        const last = page[page.length - 1];
        if (!last?.id || page.length < pageSize) break;
        after = last.id;
      }
    }
  }
}
