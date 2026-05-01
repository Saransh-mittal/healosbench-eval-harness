import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ClinicalExtraction, DatasetCase } from "@test-evals/shared";

import { dataDir } from "../lib/paths";

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function loadSchema(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dataDir, "schema.json"), "utf8")) as Record<string, unknown>;
}

export async function loadDataset(filter?: { limit?: number; cases?: string[] }): Promise<DatasetCase[]> {
  const transcriptDir = join(dataDir, "transcripts");
  const goldDir = join(dataDir, "gold");
  const requested = filter?.cases ? new Set(filter.cases) : null;
  const files = (await readdir(transcriptDir)).filter((file) => file.endsWith(".txt")).sort();
  const selected = requested ? files.filter((file) => requested.has(basename(file, ".txt"))) : files;
  const limited = filter?.limit ? selected.slice(0, filter.limit) : selected;

  return Promise.all(
    limited.map(async (file) => {
      const id = basename(file, ".txt");
      const transcriptPath = join(transcriptDir, file);
      const goldPath = join(goldDir, `${id}.json`);
      const [transcript, goldRaw] = await Promise.all([readFile(transcriptPath, "utf8"), readFile(goldPath, "utf8")]);
      return {
        id,
        transcriptPath,
        goldPath,
        transcript,
        gold: JSON.parse(goldRaw) as ClinicalExtraction,
        transcriptHash: hashText(transcript),
        goldHash: hashText(goldRaw),
      };
    }),
  );
}
