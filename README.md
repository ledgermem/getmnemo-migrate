# @ledgermem/migrate

Importer CLI for moving memories from other providers (or raw JSONL) into [LedgerMem](https://proofly.dev). Resumable, concurrent, and dry-run friendly.

## Install

```bash
npm install -g @ledgermem/migrate
```

## Quickstart

```bash
export LEDGERMEM_API_KEY=...
export LEDGERMEM_WORKSPACE_ID=ws_...
export MEM0_API_KEY=...

ledgermem-migrate plan from mem0
ledgermem-migrate from mem0 --concurrency 5
ledgermem-migrate status
```

## Commands

| Command | Description |
| --- | --- |
| `from <source>` | Run a migration from `<source>` into the configured LedgerMem workspace. |
| `plan from <source>` | Count records and print a sample — no writes. |
| `resume <jobId>` | Resume an interrupted job (skips records that were already written). |
| `status [jobId]` | Show one job's full state, or list the most recent jobs. |
| `cancel <jobId>` | Mark a running job as `paused` locally. |

Common flags: `--concurrency <n>` (default `5`), `--page-size <n>` (default `100`), `--user <id>`, `--base-url <url>`.

Job state is persisted to `~/.ledgermem/migrations/<jobId>.json`.

## Adapters

### `mem0`

Pulls memories from the [Mem0](https://mem0.ai) API.

- Required env: `MEM0_API_KEY`
- Optional: `--user <id>` to scope to a single Mem0 user, `--base-url` to override (default `https://api.mem0.ai`).
- Pagination: follows the `next` cursor returned by `/v1/memories/`.

```bash
MEM0_API_KEY=... ledgermem-migrate from mem0 --user u_42
```

### `zep`

Pulls messages from [Zep Cloud](https://www.getzep.com).

- Required env: `ZEP_API_KEY`
- **Required flag:** `--user <id>` (Zep memories belong to a user).
- Optional: `--base-url` (default `https://api.getzep.com`).
- Walks every session belonging to the user and exports each message as a memory.

```bash
ZEP_API_KEY=... ledgermem-migrate from zep --user u_42
```

### `supermemory`

Pulls items from the Supermemory API.

- Required env: `SUPERMEMORY_API_KEY`
- Optional: `--base-url` (default `https://api.supermemory.ai`).
- Uses the `/v3/memories` cursor pagination.

```bash
SUPERMEMORY_API_KEY=... ledgermem-migrate from supermemory
```

### `letta`

Pulls both core memory blocks and archival memories from a Letta server.

- Required env: `LETTA_API_KEY`, `LETTA_BASE_URL`
- Iterates every agent and exports core blocks (`core_block` kind) plus paginated archival memories (`archival` kind).

```bash
LETTA_API_KEY=... LETTA_BASE_URL=https://my-letta-host \
  ledgermem-migrate from letta
```

### `raw-jsonl`

Generic ingest from a local JSONL file. Each line is one record.

- Required flag: `--file <path>`
- Optional: `--map content=text,id=mem_id,topic=category` (default `content=content,id=id`).
- Dotted paths are supported in `--map` source keys (`content=payload.body`).

```bash
ledgermem-migrate from raw-jsonl \
  --file ./memories.jsonl \
  --map content=text,id=mem_id,user=user_id
```

## Resuming

Every successful write records the source's native id in the job state. Re-running with `resume <jobId>` skips those ids, so transient network failures are recoverable without dedup work.

```bash
ledgermem-migrate from mem0 --concurrency 10
# ... interrupted ...
ledgermem-migrate status
ledgermem-migrate resume mig_abc123...
```

## Environment

| Variable | Purpose |
| --- | --- |
| `LEDGERMEM_API_KEY` | Destination API key. **Required.** |
| `LEDGERMEM_WORKSPACE_ID` | Destination workspace. **Required.** |
| `LEDGERMEM_API_URL` | Destination API base URL (default `https://api.proofly.dev`). |
| `MEM0_API_KEY` | mem0 adapter |
| `ZEP_API_KEY` | zep adapter |
| `SUPERMEMORY_API_KEY` | supermemory adapter |
| `LETTA_API_KEY` + `LETTA_BASE_URL` | letta adapter |

## License

[MIT](./LICENSE)
