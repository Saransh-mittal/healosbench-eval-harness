import type {
  CaseDetailDto,
  CaseScore,
  CompareFieldDelta,
  CompareRunDto,
  FieldName,
  RunAggregate,
  RunCaseListItem,
  RunDetailDto,
  RunListItem,
  TokenUsage,
} from "@test-evals/shared";
import { COMPARE_WIN_THRESHOLD, emptyUsage } from "@test-evals/shared";
import { and, eq } from "drizzle-orm";

import { db } from "@test-evals/db";
import { evalRunCases, evalRuns, llmAttempts } from "@test-evals/db/schema/eval";

import { loadDataset } from "./dataset.service";

function cacheReadRatio(usage: TokenUsage): number {
  const denominator = usage.inputTokens + usage.cacheReadInputTokens;
  return denominator === 0 ? 0 : usage.cacheReadInputTokens / denominator;
}

function toRunListItem(row: typeof evalRuns.$inferSelect): RunListItem {
  const aggregate = row.aggregate as RunAggregate | null;
  const usage = aggregate?.usage ?? emptyUsage();
  return {
    id: row.id,
    strategy: row.strategy as RunListItem["strategy"],
    model: row.model,
    promptHash: row.promptHash,
    status: row.status as RunListItem["status"],
    macroFieldScore: aggregate?.macroFieldScore ?? null,
    averageCaseScore: aggregate?.averageCaseScore ?? null,
    schemaFailureRate: aggregate?.schemaFailureRate ?? null,
    hallucinationCount: aggregate?.hallucinationCount ?? 0,
    totalCostUsd: aggregate?.totalCostUsd ?? 0,
    durationMs: aggregate?.durationMs ?? null,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheReadRatio: cacheReadRatio(usage),
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function toRunCase(row: typeof evalRunCases.$inferSelect): RunCaseListItem {
  const score = row.scores as CaseScore | null;
  return {
    id: row.id,
    transcriptId: row.transcriptId,
    status: row.status as RunCaseListItem["status"],
    macroScore: score?.macroScore ?? null,
    fieldScores: score?.fieldScores ?? null,
    hallucinationCount: score?.hallucinations.length ?? 0,
    schemaValid: row.schemaValid,
    costUsd: Number(row.costUsd ?? 0),
    errorMessage: row.errorMessage,
  };
}

export async function listRuns(): Promise<RunListItem[]> {
  const rows = await db.select().from(evalRuns).orderBy(evalRuns.createdAt);
  return rows.map(toRunListItem).reverse();
}

export async function getRunDetail(runId: string): Promise<RunDetailDto | null> {
  const [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, runId)).limit(1);
  if (!run) return null;
  const cases = await db.select().from(evalRunCases).where(eq(evalRunCases.runId, runId));
  return {
    ...toRunListItem(run),
    aggregate: (run.aggregate as RunAggregate | null) ?? null,
    cases: cases.map(toRunCase).sort((a, b) => a.transcriptId.localeCompare(b.transcriptId)),
  };
}

export async function getCaseDetail(runId: string, transcriptId: string): Promise<CaseDetailDto | null> {
  const [row] = await db
    .select()
    .from(evalRunCases)
    .where(and(eq(evalRunCases.runId, runId), eq(evalRunCases.transcriptId, transcriptId)))
    .limit(1);
  if (!row) return null;
  const dataset = await loadDataset({ cases: [transcriptId] });
  const datasetCase = dataset[0];
  if (!datasetCase) return null;
  const attempts = await db.select().from(llmAttempts).where(eq(llmAttempts.runCaseId, row.id));
  return {
    ...toRunCase(row),
    transcript: datasetCase.transcript,
    gold: datasetCase.gold,
    prediction: row.prediction as CaseDetailDto["prediction"],
    hallucinations: ((row.scores as CaseScore | null)?.hallucinations ?? []) as CaseDetailDto["hallucinations"],
    attempts: attempts
      .map((attempt) => attempt.trace as CaseDetailDto["attempts"][number])
      .sort((a, b) => a.attempt - b.attempt),
  };
}

function caseScore(row: typeof evalRunCases.$inferSelect, field: FieldName): number {
  return ((row.scores as CaseScore | null)?.fieldScores[field].score ?? 0) as number;
}

export async function compareRuns(leftId: string, rightId: string): Promise<CompareRunDto | null> {
  const [left, right] = await Promise.all([getRunDetail(leftId), getRunDetail(rightId)]);
  if (!left || !right) return null;
  const [leftRows, rightRows] = await Promise.all([
    db.select().from(evalRunCases).where(eq(evalRunCases.runId, leftId)),
    db.select().from(evalRunCases).where(eq(evalRunCases.runId, rightId)),
  ]);
  const rightByTranscript = new Map(rightRows.map((row) => [row.transcriptId, row]));
  const fields: FieldName[] = ["chief_complaint", "vitals", "medications", "diagnoses", "plan", "follow_up"];
  const deltas: CompareFieldDelta[] = fields.map((field) => {
    let leftCaseWins = 0;
    let rightCaseWins = 0;
    let ties = 0;
    for (const leftRow of leftRows) {
      const rightRow = rightByTranscript.get(leftRow.transcriptId);
      if (!rightRow) continue;
      const delta = caseScore(rightRow, field) - caseScore(leftRow, field);
      if (Math.abs(delta) <= COMPARE_WIN_THRESHOLD) ties += 1;
      else if (delta > 0) rightCaseWins += 1;
      else leftCaseWins += 1;
    }
    const leftScore = left.aggregate?.fieldScores[field] ?? 0;
    const rightScore = right.aggregate?.fieldScores[field] ?? 0;
    const delta = rightScore - leftScore;
    return {
      field,
      leftScore,
      rightScore,
      delta,
      winner: Math.abs(delta) <= COMPARE_WIN_THRESHOLD ? "tie" : delta > 0 ? "right" : "left",
      leftCaseWins,
      rightCaseWins,
      ties,
    };
  });

  return {
    left,
    right,
    fields: deltas,
    schemaFailureDelta: (right.schemaFailureRate ?? 0) - (left.schemaFailureRate ?? 0),
    hallucinationDelta: right.hallucinationCount - left.hallucinationCount,
  };
}
