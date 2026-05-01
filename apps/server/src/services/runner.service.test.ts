import { describe, expect, test } from "bun:test";

import { extractionCacheKey, resumeActionForStatus, withBackoff } from "./runner.service";

describe("runner helpers", () => {
  test("resume state avoids second extraction after extracted state", () => {
    expect(resumeActionForStatus("extracted")).toBe("score");
    expect(resumeActionForStatus("done")).toBe("skip");
    expect(resumeActionForStatus("pending")).toBe("extract");
  });

  test("cache key is stable and includes prompt hash", () => {
    const key = extractionCacheKey({
      transcriptId: "case_001",
      transcriptHash: "t1",
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      promptHash: "p1",
    });
    expect(key).toContain("case_001");
    expect(key).toContain("p1");
  });

  test("rate-limit backoff retries mocked 429", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await withBackoff(
      async () => {
        calls += 1;
        if (calls === 1) {
          const error = new Error("rate limited") as Error & { status: number; headers: Record<string, string> };
          error.status = 429;
          error.headers = { "retry-after": "1" };
          throw error;
        }
        return "ok";
      },
      async (ms) => {
        sleeps.push(ms);
      },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(sleeps[0]).toBe(1000);
  });
});
