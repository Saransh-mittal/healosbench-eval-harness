import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { DEFAULT_MODEL } from "@test-evals/shared";

import { runStandaloneEval } from "./standalone-eval.service";

describe("standalone eval", () => {
  test("runs an offline smoke eval without Postgres or Anthropic credentials", async () => {
    const dir = await mkdtemp(join(tmpdir(), "healosbench-standalone-"));
    const result = await runStandaloneEval(
      {
        strategy: "zero_shot",
        model: DEFAULT_MODEL,
        force: false,
        dataset_filter: { limit: 1 },
      },
      {
        apiKey: "",
        cacheDir: join(dir, "cache"),
        resultsDir: join(dir, "results"),
      },
    );

    expect(result.mode).toBe("offline_smoke");
    expect(result.cases).toHaveLength(1);
    expect(result.aggregate.schemaFailureRate).toBe(0);
    expect(result.runDir.startsWith(join(dir, "results"))).toBe(true);
  });
});
