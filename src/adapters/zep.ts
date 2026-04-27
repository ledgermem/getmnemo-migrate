import { Adapter, AdapterConfig, SourceRecord } from "./base.js";

interface ZepMessage {
  uuid?: string;
  role?: string;
  role_type?: string;
  content?: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

interface ZepMessagesPage {
  messages?: ZepMessage[];
  total_count?: number;
  cursor?: string | null;
}

interface ZepSession {
  session_id?: string;
}

interface ZepSessionsPage {
  sessions?: ZepSession[];
  total_count?: number;
  cursor?: string | null;
}

const DEFAULT_BASE_URL = "https://api.getzep.com";

export class ZepAdapter extends Adapter {
  readonly name = "zep";

  private apiKey: string;
  private baseUrl: string;

  constructor(cfg: AdapterConfig = {}) {
    super(cfg);
    const key = process.env.ZEP_API_KEY;
    if (!key) {
      throw new Error("ZEP_API_KEY is required for the zep adapter");
    }
    this.apiKey = key;
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl + "/"), {
      headers: {
        Authorization: `Api-Key ${this.apiKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`zep request failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  async count(): Promise<number | null> {
    if (this.cfg.user) {
      const sessions = await this.request<ZepSessionsPage>(
        `/api/v2/users/${encodeURIComponent(this.cfg.user)}/sessions?limit=1`,
      );
      return sessions.total_count ?? null;
    }
    return null;
  }

  async *iterate(): AsyncIterable<SourceRecord> {
    const pageSize = this.cfg.pageSize ?? 100;
    if (!this.cfg.user) {
      throw new Error("--user is required for the zep adapter (Zep memories belong to a user)");
    }
    const userId = this.cfg.user;

    let sessionCursor: string | null = null;
    do {
      const sessionsPath = `/api/v2/users/${encodeURIComponent(userId)}/sessions?limit=${pageSize}${
        sessionCursor ? `&cursor=${encodeURIComponent(sessionCursor)}` : ""
      }`;
      const sessionsPage = await this.request<ZepSessionsPage>(sessionsPath);
      const sessions = sessionsPage.sessions ?? [];
      for (const session of sessions) {
        const sid = session.session_id;
        if (!sid) continue;
        let msgCursor: string | null = null;
        do {
          const path = `/api/v2/sessions/${encodeURIComponent(sid)}/messages?limit=${pageSize}${
            msgCursor ? `&cursor=${encodeURIComponent(msgCursor)}` : ""
          }`;
          const messagesPage = await this.request<ZepMessagesPage>(path);
          for (const msg of messagesPage.messages ?? []) {
            if (!msg.content) continue;
            yield {
              sourceId: msg.uuid,
              content: msg.content,
              metadata: {
                source: "zep",
                userId,
                sessionId: sid,
                ...(msg.role ? { role: msg.role } : {}),
                ...(msg.role_type ? { roleType: msg.role_type } : {}),
                ...(msg.created_at ? { sourceCreatedAt: msg.created_at } : {}),
                ...(msg.metadata ?? {}),
              },
            };
          }
          msgCursor = messagesPage.cursor ?? null;
        } while (msgCursor);
      }
      sessionCursor = sessionsPage.cursor ?? null;
    } while (sessionCursor);
  }
}
