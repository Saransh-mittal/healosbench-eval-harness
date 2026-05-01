import type { TokenUsage } from "@test-evals/shared";

// Last checked against Anthropic public pricing docs on 2026-05-01.
// Values are USD per 1M tokens and can be overridden by editing this table.
export const MODEL_PRICING_USD_PER_MILLION: Record<
  string,
  {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
  }
> = {
  "claude-haiku-4-5-20251001": {
    input: 1,
    output: 5,
    cacheWrite: 1.25,
    cacheRead: 0.1,
  },
};

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const pricing =
    MODEL_PRICING_USD_PER_MILLION[model] ?? MODEL_PRICING_USD_PER_MILLION["claude-haiku-4-5-20251001"]!;
  return (
    (usage.inputTokens * pricing.input +
      usage.outputTokens * pricing.output +
      usage.cacheCreationInputTokens * pricing.cacheWrite +
      usage.cacheReadInputTokens * pricing.cacheRead) /
    1_000_000
  );
}
