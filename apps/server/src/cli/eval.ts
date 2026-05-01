import type { CreateRunRequest, PromptStrategy } from "@test-evals/shared";
import { DEFAULT_MODEL, PROMPT_STRATEGIES } from "@test-evals/shared";

import { getRunDetail } from "../services/results.service";
import { rescoreEval, runEvalAndWait } from "../services/runner.service";

function parseArgs(argv: string[]): CreateRunRequest {
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
  return {
    strategy,
    model: typeof parsed.model === "string" ? parsed.model : DEFAULT_MODEL,
    force: parsed.force === true || parsed.force === "true",
    dataset_filter: cases || limit ? { cases, limit } : undefined,
  };
}

function printRun(detail: Awaited<ReturnType<typeof getRunDetail>>): void {
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

async function main(): Promise<void> {
  const request = parseArgs(process.argv.slice(2));
  const rescoreArg = process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--rescore="))
    ?.split("=")[1];
  if (rescoreArg) {
    await rescoreEval(rescoreArg);
    printRun(await getRunDetail(rescoreArg));
    return;
  }

  const strategies: PromptStrategy[] =
    request.strategy === "all" ? [...PROMPT_STRATEGIES] : [request.strategy as PromptStrategy];
  const runIds: string[] = [];

  for (const strategy of strategies) {
    const runId = await runEvalAndWait({ ...request, strategy });
    runIds.push(runId);
    printRun(await getRunDetail(runId));
  }

  console.log(`\nCompleted ${runIds.length} run(s): ${runIds.join(", ")}`);
}

await main();
