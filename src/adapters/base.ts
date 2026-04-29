export interface SourceRecord {
  /** Provider-native id; carried into Mnemo metadata for traceability. */
  sourceId?: string;
  /** Free-form text content to be stored as a memory. */
  content: string;
  /** Optional metadata to merge into the Mnemo memory. */
  metadata?: Record<string, unknown>;
}

export interface AdapterConfig {
  /** Optional path to a JSONL file (used by raw-jsonl adapter). */
  file?: string;
  /** Optional mapping like `content=text,id=mem_id`. */
  map?: string;
  /** Optional explicit user/agent id (some providers require it). */
  user?: string;
  /** Optional override for the provider base URL. */
  baseUrl?: string;
  /** Page size hint for paginated providers. */
  pageSize?: number;
}

export abstract class Adapter {
  abstract readonly name: string;

  constructor(protected readonly cfg: AdapterConfig = {}) {}

  /** Best-effort total record count. Return null if unknown. */
  abstract count(): Promise<number | null>;

  /** Async iterator yielding source records. */
  abstract iterate(): AsyncIterable<SourceRecord>;
}
