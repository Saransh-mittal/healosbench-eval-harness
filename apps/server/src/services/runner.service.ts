import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractClinicalJson, buildPrompt } from "@test-evals/llm";
import type {
  CaseScore,
  ClinicalExtraction,
  CreateRunRequest,
  DatasetCase,
  LlmAttemptTrace,
  PromptStrategy,
  RunAggregate,
  TokenUsage,
} from "@test-evals/shared";
import { addUsage, DEFAULT_MODEL, emptyUsage, PROMPT_STRATEGIES } from "@test-evals/shared";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@test-evals/db";
import { evalRunCases, evalRuns, extractionCache, llmAttempts } from "@test-evals/db/schema/eval";
import { env } from "@test-evals/env/server";

import { resultsDir } from "../lib/paths";
import { loadDataset, loadSchema } from "./dataset.service";
import { evaluateCase, summarizeScores } from "./evaluate.service";
import { runEvents } from "./events.service";
import { createExtractionValidator } from "./schema.service";

const MAX_CONCURRENCY = 5;

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimit(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return status === 429 || status === 529;
}

function retryAfterMs(error: unknown, attempt: number): number {
  const headers = (error as { headers?: Headers | Record<string, string> })?.headers;
  const raw = headers instanceof Headers ? headers.get("retry-after") : headers?.["retry-after"];
  const parsed = raw ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed * 1000;
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 400);
}

function aggregateUsage(usages: TokenUsage[]): TokenUsage {
  return usages.reduce((sum, usage) => addUsage(sum, usage), emptyUsage());
}

export async function withBackoff<T>(
  operation: () => Promise<T>,
  sleeper: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isRateLimit(error) || attempt >= 5) throw error;
      await sleeper(retryAfterMs(error, attempt));
      attempt += 1;
    }
  }
}

export function resumeActionForStatus(status: string): "skip" | "score" | "extract" {
  if (status === "done") return "skip";
  if (status === "extracted") return "score";
  return "extract";
}

export function extractionCacheKey(args: {
  transcriptId: string;
  transcriptHash: string;
  strategy: PromptStrategy;
  model: string;
  promptHash: string;
}): string {
  return `${args.transcriptId}:${args.transcriptHash}:${args.strategy}:${args.model}:${args.promptHash}`;
}

async function mapConcurrent<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item) await worker(item);
    }
  });
  await Promise.all(workers);
}

async function insertAttempts(runCaseId: string, attempts: LlmAttemptTrace[]): Promise<void> {
  if (attempts.length === 0) return;
  await db.insert(llmAttempts).values(
    attempts.map((trace) => {
      return {
        id: id("attempt"),
        runCaseId,
        attempt: trace.attempt,
        stage: trace.stage,
        status: trace.status,
        trace,
      };
    }),
  );
}

async function findCachedExtraction(args: {
  transcriptId: string;
  transcriptHash: string;
  strategy: PromptStrategy;
  model: string;
  promptHash: string;
}) {
  const [cached] = await db
    .select()
    .from(extractionCache)
    .where(
      and(
        eq(extractionCache.transcriptId, args.transcriptId),
        eq(extractionCache.transcriptHash, args.transcriptHash),
        eq(extractionCache.strategy, args.strategy),
        eq(extractionCache.model, args.model),
        eq(extractionCache.promptHash, args.promptHash),
      ),
    )
    .limit(1);
  return cached;
}

async function scoreAndPersistCase(args: {
  runCaseId: string;
  runId: string;
  datasetCase: DatasetCase;
  prediction: ClinicalExtraction | null;
  schemaValid: boolean;
  usage: TokenUsage;
  costUsd: number;
  cacheHit: boolean;
}): Promise<CaseScore> {
  await db
    .update(evalRunCases)
    .set({
      status: "scoring",
      prediction: args.prediction,
      schemaValid: args.schemaValid,
      usage: args.usage,
      costUsd: String(args.costUsd),
      cacheHit: args.cacheHit,
    })
    .where(eq(evalRunCases.id, args.runCaseId));

  const score = evaluateCase({
    transcriptId: args.datasetCase.id,
    transcript: args.datasetCase.transcript,
    prediction: args.prediction,
    gold: args.datasetCase.gold,
    schemaValid: args.schemaValid,
  });

  await db
    .update(evalRunCases)
    .set({
      status: "done",
      scores: score,
      hallucinations: score.hallucinations,
      completedAt: new Date(),
    })
    .where(eq(evalRunCases.id, args.runCaseId));

  runEvents.publish({
    type: "case_scored",
    runId: args.runId,
    transcriptId: args.datasetCase.id,
    payload: { macroScore: score.macroScore, hallucinations: score.hallucinations.length },
  });

  return score;
}

async function runSingleCase(args: {
  runId: string;
  runCaseId: string;
  datasetCase: DatasetCase;
  strategy: PromptStrategy;
  model: string;
  promptHash: string;
  toolSchema: Record<string, unknown>;
  force: boolean;
}): Promise<CaseScore> {
  const existingRows = await db.select().from(evalRunCases).where(eq(evalRunCases.id, args.runCaseId)).limit(1);
  const existing = existingRows[0];
  if (!existing) throw new Error(`Missing run case ${args.runCaseId}`);

  if (existing.status === "done" && existing.scores) {
    return existing.scores as unknown as CaseScore;
  }

  if (existing.status === "extracted" && existing.prediction !== undefined) {
    return scoreAndPersistCase({
      runCaseId: args.runCaseId,
      runId: args.runId,
      datasetCase: args.datasetCase,
      prediction: existing.prediction as ClinicalExtraction | null,
      schemaValid: existing.schemaValid ?? false,
      usage: (existing.usage as TokenUsage | null) ?? emptyUsage(),
      costUsd: Number(existing.costUsd ?? 0),
      cacheHit: existing.cacheHit,
    });
  }

  runEvents.publish({ type: "case_started", runId: args.runId, transcriptId: args.datasetCase.id });
  await db
    .update(evalRunCases)
    .set({ status: "extracting", startedAt: new Date() })
    .where(eq(evalRunCases.id, args.runCaseId));

  const cached = args.force
    ? undefined
    : await findCachedExtraction({
        transcriptId: args.datasetCase.id,
        transcriptHash: args.datasetCase.transcriptHash,
        strategy: args.strategy,
        model: args.model,
        promptHash: args.promptHash,
      });

  if (cached) {
    return scoreAndPersistCase({
      runCaseId: args.runCaseId,
      runId: args.runId,
      datasetCase: args.datasetCase,
      prediction: cached.prediction,
      schemaValid: cached.schemaValid,
      usage: emptyUsage(),
      costUsd: 0,
      cacheHit: true,
    });
  }

  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required to run extraction.");
  }

  const validator = createExtractionValidator(args.toolSchema);
  const result = await withBackoff(() =>
    extractClinicalJson({
      apiKey: env.ANTHROPIC_API_KEY!,
      model: args.model,
      transcript: args.datasetCase.transcript,
      strategy: args.strategy,
      toolSchema: args.toolSchema,
      validate: validator,
    }),
  );

  await insertAttempts(args.runCaseId, result.attempts);
  result.attempts.forEach((attempt) => {
    runEvents.publish({
      type: "case_attempt",
      runId: args.runId,
      transcriptId: args.datasetCase.id,
      payload: attempt,
    });
  });

  await db.insert(extractionCache).values({
    id: id("cache"),
    transcriptId: args.datasetCase.id,
    transcriptHash: args.datasetCase.transcriptHash,
    strategy: args.strategy,
    model: args.model,
    promptHash: args.promptHash,
    prediction: result.prediction,
    schemaValid: result.schemaValid,
    usage: result.usage,
    costUsd: String(result.costUsd),
  });

  await db
    .update(evalRunCases)
    .set({
      status: "extracted",
      prediction: result.prediction,
      schemaValid: result.schemaValid,
      usage: result.usage,
      costUsd: String(result.costUsd),
      cacheHit: false,
    })
    .where(eq(evalRunCases.id, args.runCaseId));

  runEvents.publish({
    type: "case_extracted",
    runId: args.runId,
    transcriptId: args.datasetCase.id,
    payload: { schemaValid: result.schemaValid, usage: result.usage, costUsd: result.costUsd },
  });

  return scoreAndPersistCase({
    runCaseId: args.runCaseId,
    runId: args.runId,
    datasetCase: args.datasetCase,
    prediction: result.prediction,
    schemaValid: result.schemaValid,
    usage: result.usage,
    costUsd: result.costUsd,
    cacheHit: false,
  });
}

async function ensureRunCases(runId: string, cases: DatasetCase[]): Promise<Map<string, string>> {
  const existing = await db.select().from(evalRunCases).where(eq(evalRunCases.runId, runId));
  const existingIds = new Map(existing.map((item) => [item.transcriptId, item.id]));
  const missing = cases.filter((item) => !existingIds.has(item.id));
  if (missing.length > 0) {
    await db.insert(evalRunCases).values(
      missing.map((item) => {
        const runCaseId = id("case");
        existingIds.set(item.id, runCaseId);
        return {
          id: runCaseId,
          runId,
          transcriptId: item.id,
          transcriptHash: item.transcriptHash,
          goldHash: item.goldHash,
          gold: item.gold,
          status: "pending",
        };
      }),
    );
  }
  return existingIds;
}

async function persistAggregate(runId: string, scores: CaseScore[], startedAt: Date): Promise<RunAggregate> {
  const rows = await db.select().from(evalRunCases).where(eq(evalRunCases.runId, runId));
  const usage = aggregateUsage(rows.map((row) => (row.usage as TokenUsage | null) ?? emptyUsage()));
  const durationMs = Date.now() - startedAt.getTime();
  const summary = summarizeScores(scores);
  const aggregate: RunAggregate = {
    ...summary,
    usage,
    totalCostUsd: rows.reduce((sum, row) => sum + Number(row.costUsd ?? 0), 0),
    durationMs,
  };
  await db
    .update(evalRuns)
    .set({ status: "completed", aggregate, completedAt: new Date() })
    .where(eq(evalRuns.id, runId));
  return aggregate;
}

async function writeRunSummary(args: {
  runId: string;
  strategy: PromptStrategy;
  model: string;
  promptHash: string;
  aggregate: RunAggregate;
  scores: CaseScore[];
}): Promise<void> {
  const dir = join(resultsDir, args.runId);
  await mkdir(dir, { recursive: true });
  const worst = [...args.scores].sort((a, b) => a.macroScore - b.macroScore).slice(0, 5);
  const content = `# HEALOSBENCH Run ${args.runId}

Strategy: ${args.strategy}
Model: ${args.model}
Prompt hash: ${args.promptHash}

| Metric | Value |
| --- | ---: |
| Macro field score | ${args.aggregate.macroFieldScore.toFixed(3)} |
| Average case score | ${args.aggregate.averageCaseScore.toFixed(3)} |
| Schema failure rate | ${(args.aggregate.schemaFailureRate * 100).toFixed(1)}% |
| Hallucinations | ${args.aggregate.hallucinationCount} |
| Cost USD | $${args.aggregate.totalCostUsd.toFixed(4)} |
| Cache read ratio | ${
    args.aggregate.usage.inputTokens + args.aggregate.usage.cacheReadInputTokens === 0
      ? "0.000"
      : (
          args.aggregate.usage.cacheReadInputTokens /
          (args.aggregate.usage.inputTokens + args.aggregate.usage.cacheReadInputTokens)
        ).toFixed(3)
  } |

## Field Scores

${Object.entries(args.aggregate.fieldScores)
  .map(([field, score]) => `- ${field}: ${score.toFixed(3)}`)
  .join("\n")}

## Worst 5 Cases

${worst
  .map(
    (item) =>
      `- ${item.transcriptId}: ${item.macroScore.toFixed(3)}, hallucinations=${item.hallucinations.length}, schemaValid=${item.schemaValid}`,
  )
  .join("\n")}
`;
  await writeFile(join(dir, "SUMMARY.md"), content);
}

async function createRun(request: CreateRunRequest & { strategy: PromptStrategy }): Promise<string> {
  const toolSchema = await loadSchema();
  const prompt = buildPrompt(request.strategy, toolSchema);
  const dataset = await loadDataset(request.dataset_filter);
  const runId = id("run");
  const startedAt = new Date();
  await db.insert(evalRuns).values({
    id: runId,
    strategy: request.strategy,
    model: request.model || DEFAULT_MODEL,
    promptHash: prompt.promptHash,
    status: "running",
    datasetFilter: request.dataset_filter ?? null,
    startedAt,
  });
  runEvents.publish({ type: "run_started", runId, payload: { cases: dataset.length } });
  await ensureRunCases(runId, dataset);
  return runId;
}

export async function runEval(request: CreateRunRequest & { strategy: PromptStrategy }): Promise<string> {
  const runId = await createRun(request);
  void resumeEval(runId, request.force).catch(async (error) => {
    await db
      .update(evalRuns)
      .set({ status: "failed", errorMessage: error instanceof Error ? error.message : String(error) })
      .where(eq(evalRuns.id, runId));
    runEvents.publish({ type: "run_error", runId, payload: { message: error instanceof Error ? error.message : String(error) } });
  });
  return runId;
}

export async function runEvalAndWait(request: CreateRunRequest & { strategy: PromptStrategy }): Promise<string> {
  const runId = await createRun(request);
  await resumeEval(runId, request.force);
  return runId;
}

export async function resumeEval(runId: string, force = false): Promise<RunAggregate> {
  const [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, runId)).limit(1);
  if (!run) throw new Error(`Run ${runId} not found`);
  const strategy = run.strategy as PromptStrategy;
  const model = run.model || DEFAULT_MODEL;
  const toolSchema = await loadSchema();
  const promptHash = run.promptHash || buildPrompt(strategy, toolSchema).promptHash;
  const filter = run.datasetFilter as { limit?: number; cases?: string[] } | undefined;
  const dataset = await loadDataset(filter ?? undefined);
  const caseIdByTranscript = await ensureRunCases(runId, dataset);
  const startedAt = run.startedAt ?? new Date();

  await db.update(evalRuns).set({ status: "running", startedAt }).where(eq(evalRuns.id, runId));

  const incomplete = await db
    .select()
    .from(evalRunCases)
    .where(and(eq(evalRunCases.runId, runId), inArray(evalRunCases.status, ["pending", "extracting", "extracted", "scoring", "failed"])));
  const incompleteIds = new Set(incomplete.filter((item) => item.status !== "done").map((item) => item.transcriptId));
  const scores: CaseScore[] = [];

  const workItems = dataset.filter((item) => incompleteIds.has(item.id));
  const processDatasetCase = async (datasetCase: DatasetCase) => {
      const runCaseId = caseIdByTranscript.get(datasetCase.id);
      if (!runCaseId) throw new Error(`Missing case row for ${datasetCase.id}`);
      try {
        const score = await runSingleCase({
          runId,
          runCaseId,
          datasetCase,
          strategy,
          model,
          promptHash,
          toolSchema,
          force,
        });
        scores.push(score);
      } catch (error) {
        await db
          .update(evalRunCases)
          .set({ status: "failed", errorMessage: error instanceof Error ? error.message : String(error) })
          .where(eq(evalRunCases.id, runCaseId));
        runEvents.publish({
          type: "case_failed",
          runId,
          transcriptId: datasetCase.id,
          payload: { message: error instanceof Error ? error.message : String(error) },
        });
      }
  };

  const [firstWorkItem, ...remainingWorkItems] = workItems;
  if (firstWorkItem) {
    await processDatasetCase(firstWorkItem);
  }
  await mapConcurrent(remainingWorkItems, MAX_CONCURRENCY, processDatasetCase);

  const doneRows = await db.select().from(evalRunCases).where(eq(evalRunCases.runId, runId));
  const allScores = doneRows
    .filter((row) => row.scores)
    .map((row) => row.scores as unknown as CaseScore);
  const aggregate = await persistAggregate(runId, allScores, startedAt);
  await writeRunSummary({ runId, strategy, model, promptHash, aggregate, scores: allScores });
  runEvents.publish({ type: "run_complete", runId, payload: aggregate });
  return aggregate;
}

export async function rescoreEval(runId: string): Promise<RunAggregate> {
  const [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, runId)).limit(1);
  if (!run) throw new Error(`Run ${runId} not found`);
  const strategy = run.strategy as PromptStrategy;
  const model = run.model || DEFAULT_MODEL;
  const filter = run.datasetFilter as { limit?: number; cases?: string[] } | undefined;
  const dataset = await loadDataset(filter ?? undefined);
  const datasetById = new Map(dataset.map((item) => [item.id, item]));
  const rows = await db.select().from(evalRunCases).where(eq(evalRunCases.runId, runId));
  const scores: CaseScore[] = [];

  for (const row of rows) {
    const datasetCase = datasetById.get(row.transcriptId);
    if (!datasetCase || row.status !== "done") continue;
    const score = evaluateCase({
      transcriptId: row.transcriptId,
      transcript: datasetCase.transcript,
      prediction: row.prediction,
      gold: datasetCase.gold,
      schemaValid: row.schemaValid ?? false,
    });
    scores.push(score);
    await db
      .update(evalRunCases)
      .set({ scores: score, hallucinations: score.hallucinations })
      .where(eq(evalRunCases.id, row.id));
  }

  const aggregate = await persistAggregate(runId, scores, run.startedAt ?? run.createdAt);
  await writeRunSummary({ runId, strategy, model, promptHash: run.promptHash, aggregate, scores });
  return aggregate;
}

export async function runStrategies(request: CreateRunRequest): Promise<string[]> {
  const strategies = request.strategy === "all" ? PROMPT_STRATEGIES : [request.strategy];
  const runIds: string[] = [];
  for (const strategy of strategies) {
    runIds.push(await runEvalAndWait({ ...request, strategy }));
  }
  return runIds;
}
