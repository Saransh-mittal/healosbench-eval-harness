import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractClinicalJson, buildPrompt } from "@test-evals/llm";
import type { ValidationResult } from "@test-evals/llm";
import type {
  CaseScore,
  ClinicalExtraction,
  CreateRunRequest,
  DatasetCase,
  ExtractionResult,
  LlmAttemptTrace,
  PromptStrategy,
  RunAggregate,
  TokenUsage,
} from "@test-evals/shared";
import { addUsage, DEFAULT_MODEL, emptyUsage } from "@test-evals/shared";

import { repoRoot, resultsDir as defaultResultsDir } from "../lib/paths";
import { loadDataset, loadSchema } from "./dataset.service";
import { evaluateCase, summarizeScores } from "./evaluate.service";
import { normalizeText, timePhraseToDays } from "./normalizers";
import { createExtractionValidator } from "./schema.service";

const MAX_CONCURRENCY = 5;
const defaultCacheDir = join(repoRoot, ".cache", "eval");

export interface StandaloneCaseResult {
  transcriptId: string;
  prediction: ClinicalExtraction | null;
  score: CaseScore;
  schemaValid: boolean;
  usage: TokenUsage;
  costUsd: number;
  attempts: LlmAttemptTrace[];
  cacheHit: boolean;
}

export interface StandaloneEvalResult {
  id: string;
  strategy: PromptStrategy;
  model: string;
  promptHash: string;
  mode: "anthropic" | "offline_smoke";
  runDir: string;
  aggregate: RunAggregate;
  cases: StandaloneCaseResult[];
}

interface StandaloneEvalOptions {
  apiKey?: string;
  cacheDir?: string;
  resultsDir?: string;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function cachePath(cacheDir: string, args: {
  transcriptId: string;
  transcriptHash: string;
  strategy: PromptStrategy;
  model: string;
  promptHash: string;
}): string {
  return join(cacheDir, `${hashText(JSON.stringify(args))}.json`);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
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

async function withBackoff<T>(operation: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isRateLimit(error) || attempt >= 5) throw error;
      await sleep(retryAfterMs(error, attempt));
      attempt += 1;
    }
  }
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

function aggregateUsage(usages: TokenUsage[]): TokenUsage {
  return usages.reduce((sum, usage) => addUsage(sum, usage), emptyUsage());
}

function firstPatientLine(transcript: string): string {
  const line = transcript
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.toLowerCase().startsWith("patient:"));
  const text = line?.replace(/^patient:\s*/i, "").trim();
  if (!text) return "reported clinical concern";
  return text.split(/[.!?]/)[0]?.trim() || text;
}

function parseVitals(transcript: string): ClinicalExtraction["vitals"] {
  const bp = transcript.match(/\bBP\s*([0-9]{2,3}\s*\/\s*[0-9]{2,3})\b/i)?.[1]?.replace(/\s+/g, "");
  const hr = transcript.match(/\bHR\s*([0-9]{2,3})\b/i)?.[1];
  const temp = transcript.match(/\bTemp(?:erature)?\s*([0-9]{2,3}(?:\.[0-9])?)/i)?.[1];
  const spo2 = transcript.match(/\bSpO2\s*([0-9]{2,3})\s*%?/i)?.[1];
  return {
    bp: bp ?? null,
    hr: hr ? Number(hr) : null,
    temp_f: temp ? Number(temp) : null,
    spo2: spo2 ? Number(spo2) : null,
  };
}

function followUpFromTranscript(transcript: string): ClinicalExtraction["follow_up"] {
  const sentence = transcript
    .split(/(?<=[.!?])\s+/)
    .find((item) => /follow[- ]?up|call|return|come back|recheck|reassess/i.test(item));
  if (!sentence) return { interval_days: null, reason: null };
  return {
    interval_days: timePhraseToDays(sentence),
    reason: /no (need for a )?follow[- ]?up|otherwise no follow[- ]?up/i.test(sentence)
      ? "no routine follow-up needed"
      : normalizeText(sentence).slice(0, 120) || null,
  };
}

function smokeExtract(transcript: string): ClinicalExtraction {
  return {
    chief_complaint: firstPatientLine(transcript),
    vitals: parseVitals(transcript),
    medications: [],
    diagnoses: [],
    plan: [],
    follow_up: followUpFromTranscript(transcript),
  };
}

function offlineExtraction(datasetCase: DatasetCase, validate: (value: unknown) => ValidationResult): ExtractionResult {
  const startedAt = Date.now();
  const prediction = smokeExtract(datasetCase.transcript);
  const validation = validate(prediction);
  const attempts: LlmAttemptTrace[] = [
    {
      attempt: 0,
      stage: "tool",
      status: validation.ok ? "valid" : "invalid",
      requestSummary: "Offline smoke extractor used because ANTHROPIC_API_KEY is not set.",
      toolInput: prediction,
      validationErrors: validation.ok ? [] : (validation.errors ?? ["schema validation failed"]),
      usage: emptyUsage(),
      latencyMs: Date.now() - startedAt,
    },
  ];

  return {
    prediction: validation.ok ? (validation.value ?? prediction) : null,
    attempts,
    usage: emptyUsage(),
    costUsd: 0,
    schemaValid: validation.ok,
    promptHash: "",
  };
}

async function extractCase(args: {
  datasetCase: DatasetCase;
  strategy: PromptStrategy;
  model: string;
  promptHash: string;
  toolSchema: Record<string, unknown>;
  apiKey?: string;
  cacheDir: string;
  force: boolean;
}): Promise<StandaloneCaseResult> {
  const validator = createExtractionValidator(args.toolSchema);
  const cacheFile = cachePath(args.cacheDir, {
    transcriptId: args.datasetCase.id,
    transcriptHash: args.datasetCase.transcriptHash,
    strategy: args.strategy,
    model: args.model,
    promptHash: args.promptHash,
  });

  if (args.apiKey && !args.force) {
    const cached = await readJson<ExtractionResult>(cacheFile);
    if (cached) {
      const score = evaluateCase({
        transcriptId: args.datasetCase.id,
        transcript: args.datasetCase.transcript,
        prediction: cached.prediction,
        gold: args.datasetCase.gold,
        schemaValid: cached.schemaValid,
      });
      return {
        transcriptId: args.datasetCase.id,
        prediction: cached.prediction,
        score,
        schemaValid: cached.schemaValid,
        usage: emptyUsage(),
        costUsd: 0,
        attempts: cached.attempts,
        cacheHit: true,
      };
    }
  }

  const result = args.apiKey
    ? await withBackoff(() =>
        extractClinicalJson({
          apiKey: args.apiKey!,
          model: args.model,
          transcript: args.datasetCase.transcript,
          strategy: args.strategy,
          toolSchema: args.toolSchema,
          validate: validator,
        }),
      )
    : offlineExtraction(args.datasetCase, validator);

  if (args.apiKey) {
    await mkdir(args.cacheDir, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(result, null, 2));
  }

  const score = evaluateCase({
    transcriptId: args.datasetCase.id,
    transcript: args.datasetCase.transcript,
    prediction: result.prediction,
    gold: args.datasetCase.gold,
    schemaValid: result.schemaValid,
  });

  return {
    transcriptId: args.datasetCase.id,
    prediction: result.prediction,
    score,
    schemaValid: result.schemaValid,
    usage: result.usage,
    costUsd: result.costUsd,
    attempts: result.attempts,
    cacheHit: false,
  };
}

async function writeCaseArtifact(runDir: string, datasetCase: DatasetCase, result: StandaloneCaseResult): Promise<void> {
  const dir = join(runDir, "cases");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${datasetCase.id}.json`),
    JSON.stringify(
      {
        transcriptId: datasetCase.id,
        transcriptHash: datasetCase.transcriptHash,
        goldHash: datasetCase.goldHash,
        prediction: result.prediction,
        gold: datasetCase.gold,
        score: result.score,
        schemaValid: result.schemaValid,
        usage: result.usage,
        costUsd: result.costUsd,
        cacheHit: result.cacheHit,
        attempts: result.attempts,
      },
      null,
      2,
    ),
  );
}

async function writeSummary(result: StandaloneEvalResult): Promise<void> {
  const worst = [...result.cases].sort((a, b) => a.score.macroScore - b.score.macroScore).slice(0, 5);
  const summary = `# Eval Summary

Run: ${result.id}
Mode: ${result.mode === "anthropic" ? "Anthropic tool-use extraction" : "Offline smoke baseline (no ANTHROPIC_API_KEY)"}
Strategy: ${result.strategy}
Model: ${result.model}
Prompt hash: ${result.promptHash}

| Metric | Value |
| --- | ---: |
| Macro field score | ${result.aggregate.macroFieldScore.toFixed(3)} |
| Average case score | ${result.aggregate.averageCaseScore.toFixed(3)} |
| Schema failure rate | ${(result.aggregate.schemaFailureRate * 100).toFixed(1)}% |
| Hallucinations | ${result.aggregate.hallucinationCount} |
| Total cost | $${result.aggregate.totalCostUsd.toFixed(4)} |
| Duration ms | ${result.aggregate.durationMs} |
| Cache read tokens | ${result.aggregate.usage.cacheReadInputTokens} |

## Field Scores

${Object.entries(result.aggregate.fieldScores)
  .map(([field, score]) => `- ${field}: ${score.toFixed(3)}`)
  .join("\n")}

## Worst Cases

${worst
  .map(
    (item) =>
      `- ${item.transcriptId}: ${item.score.macroScore.toFixed(3)}, hallucinations=${item.score.hallucinations.length}, schemaValid=${item.schemaValid}`,
  )
  .join("\n")}
`;
  await writeFile(join(result.runDir, "SUMMARY.md"), summary);
}

export async function runStandaloneEval(
  request: CreateRunRequest & { strategy: PromptStrategy },
  options: StandaloneEvalOptions = {},
): Promise<StandaloneEvalResult> {
  const startedAt = Date.now();
  const apiKey = (options.apiKey ?? process.env.ANTHROPIC_API_KEY)?.trim();
  const mode: StandaloneEvalResult["mode"] = apiKey ? "anthropic" : "offline_smoke";
  const model = request.model || DEFAULT_MODEL;
  const toolSchema = await loadSchema();
  const prompt = buildPrompt(request.strategy, toolSchema);
  const dataset = await loadDataset(request.dataset_filter);
  const runId = id("run");
  const runDir = join(options.resultsDir ?? defaultResultsDir, runId);
  const cacheDir = options.cacheDir ?? defaultCacheDir;
  const cases: StandaloneCaseResult[] = [];
  const datasetById = new Map(dataset.map((item) => [item.id, item]));

  await mkdir(runDir, { recursive: true });

  await mapConcurrent(dataset, apiKey ? MAX_CONCURRENCY : 1, async (datasetCase) => {
    const result = await extractCase({
      datasetCase,
      strategy: request.strategy,
      model,
      promptHash: prompt.promptHash,
      toolSchema,
      apiKey,
      cacheDir,
      force: request.force ?? false,
    });
    cases.push(result);
    await writeCaseArtifact(runDir, datasetCase, result);
  });

  cases.sort((a, b) => a.transcriptId.localeCompare(b.transcriptId));
  const scoreSummary = summarizeScores(cases.map((item) => item.score));
  const aggregate: RunAggregate = {
    ...scoreSummary,
    totalCostUsd: cases.reduce((sum, item) => sum + item.costUsd, 0),
    durationMs: Date.now() - startedAt,
    usage: aggregateUsage(cases.map((item) => item.usage)),
  };
  const result: StandaloneEvalResult = {
    id: runId,
    strategy: request.strategy,
    model,
    promptHash: prompt.promptHash,
    mode,
    runDir,
    aggregate,
    cases,
  };

  await writeFile(
    join(runDir, "run.json"),
    JSON.stringify(
      {
        id: result.id,
        strategy: result.strategy,
        model: result.model,
        promptHash: result.promptHash,
        mode: result.mode,
        aggregate: result.aggregate,
        cases: result.cases.map((item) => ({
          transcriptId: item.transcriptId,
          macroScore: item.score.macroScore,
          schemaValid: item.schemaValid,
          hallucinationCount: item.score.hallucinations.length,
          costUsd: item.costUsd,
          cacheHit: item.cacheHit,
          artifact: `cases/${item.transcriptId}.json`,
          sourceTranscript: datasetById.get(item.transcriptId)?.transcriptPath,
          sourceGold: datasetById.get(item.transcriptId)?.goldPath,
        })),
      },
      null,
      2,
    ),
  );
  await writeSummary(result);
  return result;
}
