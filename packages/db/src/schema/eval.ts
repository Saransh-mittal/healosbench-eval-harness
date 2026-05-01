import { relations } from "drizzle-orm";
import type { CaseScore, ClinicalExtraction, Hallucination, LlmAttemptTrace, RunAggregate, TokenUsage } from "@test-evals/shared";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: text("id").primaryKey(),
    strategy: text("strategy").notNull(),
    model: text("model").notNull(),
    promptHash: text("prompt_hash").notNull(),
    status: text("status").notNull().default("pending"),
    datasetFilter: jsonb("dataset_filter").$type<Record<string, unknown> | null>(),
    aggregate: jsonb("aggregate").$type<RunAggregate | null>(),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("eval_runs_status_idx").on(table.status),
    index("eval_runs_strategy_model_idx").on(table.strategy, table.model),
  ],
);

export const evalRunCases = pgTable(
  "eval_run_cases",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    transcriptId: text("transcript_id").notNull(),
    transcriptHash: text("transcript_hash").notNull(),
    goldHash: text("gold_hash").notNull(),
    status: text("status").notNull().default("pending"),
    prediction: jsonb("prediction").$type<ClinicalExtraction | null>(),
    gold: jsonb("gold").$type<ClinicalExtraction>().notNull(),
    scores: jsonb("scores").$type<CaseScore | null>(),
    hallucinations: jsonb("hallucinations").$type<Hallucination[] | null>(),
    schemaValid: boolean("schema_valid"),
    cacheHit: boolean("cache_hit").default(false).notNull(),
    usage: jsonb("usage").$type<TokenUsage | null>(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).default("0").notNull(),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("eval_run_cases_run_transcript_uidx").on(table.runId, table.transcriptId),
    index("eval_run_cases_run_status_idx").on(table.runId, table.status),
  ],
);

export const extractionCache = pgTable(
  "extraction_cache",
  {
    id: text("id").primaryKey(),
    transcriptId: text("transcript_id").notNull(),
    transcriptHash: text("transcript_hash").notNull(),
    strategy: text("strategy").notNull(),
    model: text("model").notNull(),
    promptHash: text("prompt_hash").notNull(),
    prediction: jsonb("prediction").$type<ClinicalExtraction | null>(),
    schemaValid: boolean("schema_valid").notNull(),
    usage: jsonb("usage").$type<TokenUsage>().notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).default("0").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("extraction_cache_key_uidx").on(
      table.transcriptId,
      table.transcriptHash,
      table.strategy,
      table.model,
      table.promptHash,
    ),
  ],
);

export const llmAttempts = pgTable(
  "llm_attempts",
  {
    id: text("id").primaryKey(),
    runCaseId: text("run_case_id")
      .notNull()
      .references(() => evalRunCases.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    stage: text("stage").notNull(),
    status: text("status").notNull(),
    trace: jsonb("trace").$type<LlmAttemptTrace>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("llm_attempts_case_idx").on(table.runCaseId)],
);

export const evalRunsRelations = relations(evalRuns, ({ many }) => ({
  cases: many(evalRunCases),
}));

export const evalRunCasesRelations = relations(evalRunCases, ({ one, many }) => ({
  run: one(evalRuns, {
    fields: [evalRunCases.runId],
    references: [evalRuns.id],
  }),
  attempts: many(llmAttempts),
}));

export const llmAttemptsRelations = relations(llmAttempts, ({ one }) => ({
  case: one(evalRunCases, {
    fields: [llmAttempts.runCaseId],
    references: [evalRunCases.id],
  }),
}));
