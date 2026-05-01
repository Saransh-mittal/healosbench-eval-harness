import { describe, expect, test } from "bun:test";
import { DEFAULT_MODEL } from "@test-evals/shared";

import { extractClinicalJson } from "./index";
import { buildPrompt } from "./prompts";

const schema = {
  type: "object",
  required: ["chief_complaint"],
  properties: { chief_complaint: { type: "string" } },
};

describe("prompt hashing", () => {
  test("is stable for identical prompt inputs", () => {
    expect(buildPrompt("zero_shot", schema).promptHash).toBe(buildPrompt("zero_shot", schema).promptHash);
  });

  test("changes when prompt strategy changes", () => {
    expect(buildPrompt("zero_shot", schema).promptHash).not.toBe(buildPrompt("few_shot", schema).promptHash);
  });
});

describe("extractClinicalJson", () => {
  test("retries schema-invalid tool input with feedback", async () => {
    let calls = 0;
    const client = {
      messages: {
        create: async () => {
          calls += 1;
          return {
            id: `msg_${calls}`,
            stop_reason: "tool_use",
            usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: calls === 2 ? 20 : 0 },
            content: [
              {
                type: "tool_use",
                name: "record_clinical_extraction",
                input: calls === 1 ? { bad: true } : { chief_complaint: "cough" },
              },
            ],
          };
        },
      },
    };

    const result = await extractClinicalJson({
      apiKey: "test",
      model: DEFAULT_MODEL,
      transcript: "Patient has cough.",
      strategy: "zero_shot",
      toolSchema: schema,
      client: client as never,
      validate: (value) =>
        (value as { chief_complaint?: string }).chief_complaint
          ? { ok: true, value: value as never }
          : { ok: false, errors: ["chief_complaint is required"] },
    });

    expect(calls).toBe(2);
    expect(result.attempts[0]?.status).toBe("invalid");
    expect(result.schemaValid).toBe(true);
    expect(result.usage.cacheReadInputTokens).toBe(20);
  });
});
