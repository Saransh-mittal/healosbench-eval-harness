import { z } from "zod";

export const PROMPT_STRATEGIES = ["zero_shot", "few_shot", "cot"] as const;
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
export const FUZZY_MATCH_THRESHOLD = 0.85;
export const COMPARE_WIN_THRESHOLD = 0.03;

export const promptStrategySchema = z.enum(PROMPT_STRATEGIES);
export type PromptStrategy = z.infer<typeof promptStrategySchema>;

export const runStatusSchema = z.enum(["pending", "running", "completed", "failed", "canceled"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const caseStatusSchema = z.enum([
  "pending",
  "extracting",
  "extracted",
  "scoring",
  "done",
  "failed",
]);
export type CaseStatus = z.infer<typeof caseStatusSchema>;

export type VitalName = "bp" | "hr" | "temp_f" | "spo2";
export type FieldName =
  | "chief_complaint"
  | "vitals"
  | "medications"
  | "diagnoses"
  | "plan"
  | "follow_up";

export interface ClinicalExtraction {
  chief_complaint: string;
  vitals: {
    bp: string | null;
    hr: number | null;
    temp_f: number | null;
    spo2: number | null;
  };
  medications: Array<{
    name: string;
    dose: string | null;
    frequency: string | null;
    route: string | null;
  }>;
  diagnoses: Array<{
    description: string;
    icd10?: string;
  }>;
  plan: string[];
  follow_up: {
    interval_days: number | null;
    reason: string | null;
  };
}

export interface DatasetCase {
  id: string;
  transcriptPath: string;
  goldPath: string;
  transcript: string;
  gold: ClinicalExtraction;
  transcriptHash: string;
  goldHash: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface LlmAttemptTrace {
  attempt: number;
  stage: "scratchpad" | "tool";
  status: "valid" | "invalid" | "error";
  requestSummary: string;
  responseId?: string;
  stopReason?: string | null;
  scratchpad?: string;
  toolInput?: unknown;
  validationErrors: string[];
  usage: TokenUsage;
  latencyMs: number;
  errorMessage?: string;
}

export interface ExtractionResult {
  prediction: ClinicalExtraction | null;
  attempts: LlmAttemptTrace[];
  usage: TokenUsage;
  costUsd: number;
  schemaValid: boolean;
  promptHash: string;
}

export interface FieldScore {
  score: number;
  precision?: number;
  recall?: number;
  f1?: number;
  details?: Record<string, unknown>;
}

export type FieldScores = Record<FieldName, FieldScore>;

export interface Hallucination {
  path: string;
  value: string;
  reason: string;
}

export interface CaseScore {
  transcriptId: string;
  fieldScores: FieldScores;
  macroScore: number;
  hallucinations: Hallucination[];
  schemaValid: boolean;
}

export interface RunAggregate {
  macroFieldScore: number;
  averageCaseScore: number;
  fieldScores: Record<FieldName, number>;
  schemaFailureRate: number;
  hallucinationCount: number;
  totalCostUsd: number;
  durationMs: number;
  usage: TokenUsage;
}

export const createRunRequestSchema = z.object({
  strategy: z.union([promptStrategySchema, z.literal("all")]),
  model: z.string().default(DEFAULT_MODEL),
  dataset_filter: z
    .object({
      limit: z.number().int().positive().optional(),
      cases: z.array(z.string()).optional(),
    })
    .optional(),
  force: z.boolean().default(false),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export interface RunListItem {
  id: string;
  strategy: PromptStrategy;
  model: string;
  promptHash: string;
  status: RunStatus;
  macroFieldScore: number | null;
  averageCaseScore: number | null;
  schemaFailureRate: number | null;
  hallucinationCount: number;
  totalCostUsd: number;
  durationMs: number | null;
  cacheReadInputTokens: number;
  cacheReadRatio: number;
  createdAt: string;
  completedAt: string | null;
}

export interface RunCaseListItem {
  id: string;
  transcriptId: string;
  status: CaseStatus;
  macroScore: number | null;
  fieldScores: FieldScores | null;
  hallucinationCount: number;
  schemaValid: boolean | null;
  costUsd: number;
  errorMessage: string | null;
}

export interface RunDetailDto extends RunListItem {
  aggregate: RunAggregate | null;
  cases: RunCaseListItem[];
}

export interface CaseDetailDto extends RunCaseListItem {
  transcript: string;
  gold: ClinicalExtraction;
  prediction: ClinicalExtraction | null;
  hallucinations: Hallucination[];
  attempts: LlmAttemptTrace[];
}

export interface CompareFieldDelta {
  field: FieldName;
  leftScore: number;
  rightScore: number;
  delta: number;
  winner: "left" | "right" | "tie";
  leftCaseWins: number;
  rightCaseWins: number;
  ties: number;
}

export interface CompareRunDto {
  left: RunListItem;
  right: RunListItem;
  fields: CompareFieldDelta[];
  schemaFailureDelta: number;
  hallucinationDelta: number;
}

export type SseEventType =
  | "run_started"
  | "case_started"
  | "case_attempt"
  | "case_extracted"
  | "case_scored"
  | "case_failed"
  | "run_complete"
  | "run_error";

export interface SseEvent {
  type: SseEventType;
  runId: string;
  transcriptId?: string;
  payload?: unknown;
}

export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
  };
}
