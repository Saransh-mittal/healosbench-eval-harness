import Anthropic from "@anthropic-ai/sdk";
import type {
  ClinicalExtraction,
  ExtractionResult,
  LlmAttemptTrace,
  PromptStrategy,
  TokenUsage,
} from "@test-evals/shared";
import { addUsage, emptyUsage } from "@test-evals/shared";

import { estimateCostUsd } from "./pricing";
import { buildPrompt, TOOL_NAME } from "./prompts";

export type ValidationResult =
  | { ok: true; value: ClinicalExtraction }
  | { ok: false; errors: string[] };

export interface ExtractRequest {
  apiKey: string;
  model: string;
  transcript: string;
  strategy: PromptStrategy;
  toolSchema: Record<string, unknown>;
  validate: (value: unknown) => ValidationResult;
  maxAttempts?: number;
  client?: Anthropic;
}

interface MessageResponseLike {
  id?: string;
  stop_reason?: string | null;
  content?: Array<Record<string, unknown>>;
  usage?: Record<string, unknown>;
}

function readUsage(usage: Record<string, unknown> | undefined): TokenUsage {
  const cacheCreationNested = usage?.cache_creation as Record<string, unknown> | undefined;
  const nestedCreation =
    Number(cacheCreationNested?.ephemeral_5m_input_tokens ?? 0) +
    Number(cacheCreationNested?.ephemeral_1h_input_tokens ?? 0);

  return {
    inputTokens: Number(usage?.input_tokens ?? 0),
    outputTokens: Number(usage?.output_tokens ?? 0),
    cacheReadInputTokens: Number(usage?.cache_read_input_tokens ?? 0),
    cacheCreationInputTokens: Number(usage?.cache_creation_input_tokens ?? nestedCreation),
  };
}

function toolFromResponse(response: MessageResponseLike): unknown {
  return response.content?.find((block) => block.type === "tool_use" && block.name === TOOL_NAME)?.input;
}

function textFromResponse(response: MessageResponseLike): string {
  return (
    response.content
      ?.filter((block) => block.type === "text")
      .map((block) => String(block.text ?? ""))
      .join("\n")
      .trim() ?? ""
  );
}

function cacheableText(text: string) {
  return {
    type: "text" as const,
    text,
    cache_control: { type: "ephemeral" as const },
  };
}

function baseTools(toolSchema: Record<string, unknown>) {
  return [
    {
      name: TOOL_NAME,
      description: "Record the structured clinical extraction for the transcript.",
      input_schema: toolSchema,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

async function createMessage(client: Anthropic, params: Record<string, unknown>): Promise<MessageResponseLike> {
  return (await client.messages.create(params as unknown as Parameters<Anthropic["messages"]["create"]>[0])) as MessageResponseLike;
}

export async function extractClinicalJson(request: ExtractRequest): Promise<ExtractionResult> {
  const maxAttempts = request.maxAttempts ?? 3;
  const prompt = buildPrompt(request.strategy, request.toolSchema);
  const client = request.client ?? new Anthropic({ apiKey: request.apiKey });
  const attempts: LlmAttemptTrace[] = [];
  let totalUsage = emptyUsage();

  const common = {
    model: request.model,
    max_tokens: 1600,
    cache_control: { type: "ephemeral" as const },
    system: [cacheableText(prompt.system)],
    tools: baseTools(request.toolSchema),
  };

  let scratchpad = "";
  if (request.strategy === "cot") {
    const startedAt = Date.now();
    try {
      const response = await createMessage(client, {
        model: request.model,
        max_tokens: 800,
        cache_control: { type: "ephemeral" },
        system: [cacheableText(prompt.system)],
        messages: [
          {
            role: "user",
            content: `Create a concise structured extraction scratchpad for this transcript. Do not emit JSON.\n\nTranscript:\n${request.transcript}`,
          },
        ],
      });
      const usage = readUsage(response.usage);
      totalUsage = addUsage(totalUsage, usage);
      scratchpad = textFromResponse(response);
      attempts.push({
        attempt: 0,
        stage: "scratchpad",
        status: "valid",
        requestSummary: "CoT scratchpad call",
        responseId: response.id,
        stopReason: response.stop_reason,
        scratchpad,
        validationErrors: [],
        usage,
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({
        attempt: 0,
        stage: "scratchpad",
        status: "error",
        requestSummary: "CoT scratchpad call",
        validationErrors: [],
        usage: emptyUsage(),
        latencyMs: Date.now() - startedAt,
        errorMessage: message,
      });
      throw error;
    }
  }

  const messages: Array<Record<string, unknown>> = [
    {
      role: "user",
      content:
        request.strategy === "cot"
          ? `Use the scratchpad below to make the required ${TOOL_NAME} tool call.\n\nScratchpad:\n${scratchpad}\n\nTranscript:\n${request.transcript}`
          : `Extract the structured clinical JSON by calling ${TOOL_NAME}.\n\nTranscript:\n${request.transcript}`,
    },
  ];

  let prediction: ClinicalExtraction | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await createMessage(client, {
        ...common,
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages,
      });
      const usage = readUsage(response.usage);
      totalUsage = addUsage(totalUsage, usage);
      const toolInput = toolFromResponse(response);
      const validation = request.validate(toolInput);

      attempts.push({
        attempt,
        stage: "tool",
        status: validation.ok ? "valid" : "invalid",
        requestSummary: attempt === 1 ? "Initial tool extraction" : "Retry with validation feedback",
        responseId: response.id,
        stopReason: response.stop_reason,
        toolInput,
        validationErrors: validation.ok ? [] : validation.errors,
        usage,
        latencyMs: Date.now() - startedAt,
      });

      if (validation.ok) {
        prediction = validation.value;
        break;
      }

      messages.push({ role: "assistant", content: response.content as never });
      messages.push({
        role: "user",
        content: `The tool input did not match the JSON Schema. Fix only the schema issues and call ${TOOL_NAME} again.\n\nValidation errors:\n${validation.errors
          .slice(0, 12)
          .map((err) => `- ${err}`)
          .join("\n")}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({
        attempt,
        stage: "tool",
        status: "error",
        requestSummary: "Anthropic tool extraction failed",
        validationErrors: [],
        usage: emptyUsage(),
        latencyMs: Date.now() - startedAt,
        errorMessage: message,
      });
      throw error;
    }
  }

  return {
    prediction,
    attempts,
    usage: totalUsage,
    costUsd: estimateCostUsd(request.model, totalUsage),
    schemaValid: prediction !== null,
    promptHash: prompt.promptHash,
  };
}

export { buildPrompt, estimateCostUsd, TOOL_NAME };
