#!/usr/bin/env node
import { Command } from "commander";
import cliProgress from "cli-progress";
import kleur from "kleur";
import ora from "ora";
import { Mnemo } from "@getmnemo/memory";
import { ADAPTER_NAMES, AdapterConfig, createAdapter } from "./adapters/index.js";
import { migrate, planMigration } from "./lib/migrator.js";
import { listJobs, readJob, writeJob } from "./lib/jobs.js";

const VERSION = "0.1.0";

interface CommonAdapterOpts {
  file?: string;
  map?: string;
  user?: string;
  baseUrl?: string;
  pageSize?: string;
}

function buildAdapterConfig(opts: CommonAdapterOpts): AdapterConfig {
  return {
    file: opts.file,
    map: opts.map,
    user: opts.user,
    baseUrl: opts.baseUrl,
    pageSize: opts.pageSize ? Number.parseInt(opts.pageSize, 10) : undefined,
  };
}

function getMnemoClient(): Mnemo {
  const apiKey = process.env.GETMNEMO_API_KEY;
  const workspaceId = process.env.GETMNEMO_WORKSPACE_ID;
  const apiUrl = process.env.GETMNEMO_API_URL ?? "https://api.getmnemo.xyz";
  if (!apiKey || !workspaceId) {
    throw new Error(
      "GETMNEMO_API_KEY and GETMNEMO_WORKSPACE_ID must be set (run `getmnemo login` from @getmnemo/cli or export them).",
    );
  }
  return new Mnemo({ apiKey, workspaceId, apiUrl });
}

export function buildCli(): Command {
  const program = new Command();

  program
    .name("getmnemo-migrate")
    .description(`${kleur.cyan("Mnemo migrate")} — import memories from external providers.`)
    .version(VERSION, "-v, --version")
    .showHelpAfterError("(add --help for additional information)");

  const fromCmd = program
    .command("from <source>")
    .description(`migrate memories from a source (${ADAPTER_NAMES.join(", ")})`)
    .option("--concurrency <n>", "concurrent writes", "5")
    .option("--file <path>", "JSONL file (raw-jsonl adapter)")
    .option("--map <spec>", "field mapping like content=text,id=mem_id")
    .option("--user <id>", "user id (zep, optional for mem0)")
    .option("--base-url <url>", "override provider base URL")
    .option("--page-size <n>", "page size hint", "100")
    .action(async (source: string, opts: CommonAdapterOpts & { concurrency?: string }) => {
      const adapter = createAdapter(source, buildAdapterConfig(opts));
      const writer = getMnemoClient();
      const concurrency = Number.parseInt(opts.concurrency ?? "5", 10);

      const total = await adapter.count();
      const bar = new cliProgress.SingleBar(
        {
          format: `${kleur.cyan("migrate")} ${source} |{bar}| {value}/{total} written ({failed} failed) | ETA: {eta_formatted}`,
          hideCursor: true,
        },
        cliProgress.Presets.shades_classic,
      );
      bar.start(total ?? 0, 0, { failed: 0 });

      const finalState = await migrate(adapter, writer, {
        concurrency,
        onProgress: (p) => {
          if (p.total != null && bar.getTotal() !== p.total) bar.setTotal(p.total);
          bar.update(p.written, { failed: p.failed });
        },
      });

      bar.stop();
      process.stdout.write(
        `\n${kleur.green("✓")} job ${kleur.bold(finalState.id)}: ${finalState.written} written, ${finalState.failed} failed\n`,
      );
    });

  const planCmd = program
    .command("plan")
    .description("preview a migration without writing");

  planCmd
    .command("from <source>")
    .description("preview a migration plan from a source")
    .option("--file <path>", "JSONL file (raw-jsonl adapter)")
    .option("--map <spec>", "field mapping")
    .option("--user <id>", "user id (zep, optional for mem0)")
    .option("--base-url <url>", "override provider base URL")
    .option("--page-size <n>", "page size hint", "100")
    .option("--sample <n>", "sample size to print", "5")
    .action(async (source: string, opts: CommonAdapterOpts & { sample?: string }) => {
      const adapter = createAdapter(source, buildAdapterConfig(opts));
      const spinner = ora(`Counting records in ${source}...`).start();
      const sampleSize = Number.parseInt(opts.sample ?? "5", 10);
      const plan = await planMigration(adapter, sampleSize);
      spinner.stop();
      process.stdout.write(`${kleur.cyan("source:")} ${source}\n`);
      process.stdout.write(
        `${kleur.cyan("total:")}  ${plan.total != null ? plan.total : kleur.dim("unknown")}\n`,
      );
      process.stdout.write(`${kleur.cyan("sample:")}\n`);
      for (const rec of plan.sample) {
        const preview = rec.content.length > 120 ? rec.content.slice(0, 119) + "…" : rec.content;
        process.stdout.write(
          `  - ${kleur.dim(rec.sourceId ?? "(no id)")}  ${preview}\n`,
        );
      }
    });

  program
    .command("resume <jobId>")
    .description("resume a previously-failed or paused migration")
    .option("--concurrency <n>", "concurrent writes", "5")
    .option("--file <path>", "JSONL file (raw-jsonl adapter)")
    .option("--map <spec>", "field mapping")
    .option("--user <id>", "user id")
    .option("--base-url <url>", "override provider base URL")
    .option("--page-size <n>", "page size hint", "100")
    .action(async (jobId: string, opts: CommonAdapterOpts & { concurrency?: string }) => {
      const existing = await readJob(jobId);
      const adapter = createAdapter(existing.source, buildAdapterConfig(opts));
      const writer = getMnemoClient();
      const concurrency = Number.parseInt(opts.concurrency ?? "5", 10);

      const bar = new cliProgress.SingleBar(
        {
          format: `${kleur.cyan("resume")} ${existing.source} |{bar}| {value}/{total} written ({failed} failed) | ETA: {eta_formatted}`,
          hideCursor: true,
        },
        cliProgress.Presets.shades_classic,
      );
      bar.start(existing.total ?? 0, existing.written, { failed: existing.failed });

      const finalState = await migrate(adapter, writer, {
        concurrency,
        resumeJobId: jobId,
        onProgress: (p) => {
          if (p.total != null && bar.getTotal() !== p.total) bar.setTotal(p.total);
          bar.update(p.written, { failed: p.failed });
        },
      });
      bar.stop();
      process.stdout.write(
        `\n${kleur.green("✓")} resumed job ${finalState.id}: ${finalState.written} written, ${finalState.failed} failed\n`,
      );
    });

  program
    .command("status [jobId]")
    .description("show status for a single job, or list recent jobs")
    .action(async (jobId?: string) => {
      if (jobId) {
        const state = await readJob(jobId);
        process.stdout.write(JSON.stringify(state, null, 2) + "\n");
        return;
      }
      const jobs = await listJobs();
      if (jobs.length === 0) {
        process.stdout.write("No migration jobs yet.\n");
        return;
      }
      for (const j of jobs.slice(0, 20)) {
        process.stdout.write(
          `${j.id}  ${j.status.padEnd(9)}  ${j.source.padEnd(12)}  ${j.written}/${j.total ?? "?"} written\n`,
        );
      }
    });

  program
    .command("cancel <jobId>")
    .description("mark a job as paused locally")
    .action(async (jobId: string) => {
      const state = await readJob(jobId);
      state.status = "paused";
      await writeJob(state);
      process.stdout.write(`${kleur.yellow("⚠")} job ${jobId} marked as paused\n`);
    });

  program.exitOverride((err) => {
    if (err.code === "commander.helpDisplayed" || err.code === "commander.version") process.exit(0);
    if (err.code === "commander.unknownCommand" || err.code === "commander.unknownOption") process.exit(2);
    process.exit(err.exitCode ?? 1);
  });

  return program;
}

async function main(): Promise<void> {
  const program = buildCli();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    process.stderr.write(kleur.red(`error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("cli.js") ||
  process.argv[1]?.endsWith("cli.ts");

if (isMain) {
  void main();
}
