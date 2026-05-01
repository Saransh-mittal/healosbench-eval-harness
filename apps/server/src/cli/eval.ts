import "dotenv/config";
import type { CreateRunRequest, PromptStrategy } from "@test-evals/shared";
import { DEFAULT_MODEL, PROMPT_STRATEGIES } from "@test-evals/shared";

import type { StandaloneEvalResult } from "../services/standalone-eval.service";
import { runStandaloneEval } from "../services/standalone-eval.service";

type StorageMode = "local" | "db";

interface CliArgs {
  request: CreateRunRequest;
  storage: StorageMode;
  rescoreRunId?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: Record<string, string | boolean> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    if (!key) continue;
    parsed[key] = value ?? true;
  }

  const strategy = String(parsed.strategy ?? "zero_shot") as CreateRunRequest["strategy"];
  const cases = typeof parsed.cases === "string" ? parsed.cases.split(",").filter(Boolean) : undefined;
  const limit = typeof parsed.limit === "string" ? Number(parsed.limit) : undefined;
  const storage = parsed.storage === "db" ? "db" : "local";
  return {
    request: {
      strategy,
      model: typeof parsed.model === "string" ? parsed.model : DEFAULT_MODEL,
      force: parsed.force === true || parsed.force === "true",
      dataset_filter: cases || limit ? { cases, limit } : undefined,
    },
    storage,
    rescoreRunId: typeof parsed.rescore === "string" ? parsed.rescore : undefined,
  };
}

async function printDbRun(runId: string): Promise<void> {
  const { getRunDetail } = await import("../services/results.service");
  const detail = await getRunDetail(runId);
  if (!detail) return;
  const aggregate = detail.aggregate;
  console.log(`\nRun ${detail.id}`);
  console.log(`strategy=${detail.strategy} model=${detail.model} prompt_hash=${detail.promptHash.slice(0, 12)}`);
  if (!aggregate) {
    console.log("No aggregate available.");
    return;
  }
  console.table({
    macro_field_score: aggregate.macroFieldScore.toFixed(3),
    average_case_score: aggregate.averageCaseScore.toFixed(3),
    schema_failure_rate: `${(aggregate.schemaFailureRate * 100).toFixed(1)}%`,
    hallucinations: aggregate.hallucinationCount,
    cost_usd: `$${aggregate.totalCostUsd.toFixed(4)}`,
    cache_read_tokens: aggregate.usage.cacheReadInputTokens,
  });
  console.table(
    Object.entries(aggregate.fieldScores).map(([field, score]) => ({
      field,
      score: score.toFixed(3),
    })),
  );
  const failed = detail.cases.filter((item) => item.status === "failed");
  if (failed.length > 0) {
    console.log("\nFailed cases:");
    console.table(
      failed.map((item) => ({
        transcript_id: item.transcriptId,
        error: item.errorMessage ?? "unknown error",
      })),
    );
  }
}

function printStandaloneRun(result: StandaloneEvalResult): void {
  const aggregate = result.aggregate;
  console.log(`\nRun ${result.id}`);
  console.log(`mode=${result.mode} strategy=${result.strategy} model=${result.model} prompt_hash=${result.promptHash.slice(0, 12)}`);
  console.log(`artifacts=${result.runDir}`);
  if (result.mode === "offline_smoke") {
    console.log("ANTHROPIC_API_KEY is not set, so this was an offline smoke baseline. Set the key for a real LLM eval.");
  }
  console.table({
    macro_field_score: aggregate.macroFieldScore.toFixed(3),
    average_case_score: aggregate.averageCaseScore.toFixed(3),
    schema_failure_rate: `${(aggregate.schemaFailureRate * 100).toFixed(1)}%`,
    hallucinations: aggregate.hallucinationCount,
    cost_usd: `$${aggregate.totalCostUsd.toFixed(4)}`,
    cache_read_tokens: aggregate.usage.cacheReadInputTokens,
  });
  console.table(
    Object.entries(aggregate.fieldScores).map(([field, score]) => ({
      field,
      score: score.toFixed(3),
    })),
  );
}

async function main(): Promise<void> {
  const { request, storage, rescoreRunId } = parseArgs(process.argv.slice(2));
  if (rescoreRunId) {
    const { rescoreEval } = await import("../services/runner.service");
    await rescoreEval(rescoreRunId);
    await printDbRun(rescoreRunId);
    return;
  }

  const strategies: PromptStrategy[] =
    request.strategy === "all" ? [...PROMPT_STRATEGIES] : [request.strategy as PromptStrategy];
  const runIds: string[] = [];

  for (const strategy of strategies) {
    if (storage === "db") {
      const { runEvalAndWait } = await import("../services/runner.service");
      const runId = await runEvalAndWait({ ...request, strategy });
      runIds.push(runId);
      await printDbRun(runId);
    } else {
      const result = await runStandaloneEval({ ...request, strategy });
      runIds.push(result.id);
      printStandaloneRun(result);
    }
  }

  console.log(`\nCompleted ${runIds.length} run(s): ${runIds.join(", ")}`);
}

await main();
