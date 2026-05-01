import { describe, expect, test } from "bun:test";
import type { ClinicalExtraction } from "@test-evals/shared";

import { detectHallucinations, evaluateCase } from "./evaluate.service";
import { normalizeDose, normalizeFrequency, normalizeRoute, timePhraseToDays } from "./normalizers";

const base: ClinicalExtraction = {
  chief_complaint: "sore throat",
  vitals: { bp: null, hr: null, temp_f: null, spo2: null },
  medications: [],
  diagnoses: [],
  plan: [],
  follow_up: { interval_days: null, reason: null },
};

describe("normalizers", () => {
  test("normalizes medication frequency aliases", () => {
    expect(normalizeFrequency("BID")).toBe("twice daily");
    expect(normalizeFrequency("twice daily")).toBe("twice daily");
  });

  test("normalizes dose spacing and route aliases", () => {
    expect(normalizeDose("10mg")).toBe("10 mg");
    expect(normalizeRoute("by mouth")).toBe("po");
  });

  test("normalizes time phrases to days", () => {
    expect(timePhraseToDays("follow up in two weeks")).toBe(14);
  });
});

describe("evaluateCase", () => {
  test("matches medications with fuzzy name and normalized dose/frequency", () => {
    const gold: ClinicalExtraction = {
      ...base,
      medications: [{ name: "ibuprofen", dose: "400 mg", frequency: "twice daily", route: "PO" }],
    };
    const prediction: ClinicalExtraction = {
      ...base,
      medications: [{ name: "Ibuprofen", dose: "400mg", frequency: "BID", route: "by mouth" }],
    };
    const score = evaluateCase({ transcriptId: "tiny", transcript: "ibuprofen 400 mg twice daily", prediction, gold, schemaValid: true });
    expect(score.fieldScores.medications.score).toBe(1);
  });

  test("computes set-F1 correctly for tiny plan case", () => {
    const gold: ClinicalExtraction = { ...base, plan: ["drink fluids", "call if fever"] };
    const prediction: ClinicalExtraction = { ...base, plan: ["drink fluids"] };
    const score = evaluateCase({ transcriptId: "tiny", transcript: "drink fluids", prediction, gold, schemaValid: true });
    expect(score.fieldScores.plan.precision).toBe(1);
    expect(score.fieldScores.plan.recall).toBe(0.5);
    expect(score.fieldScores.plan.f1).toBeCloseTo(0.666, 2);
  });

  test("hallucination detector flags unsupported values", () => {
    const prediction: ClinicalExtraction = { ...base, vitals: { ...base.vitals, hr: 88 } };
    const hallucinations = detectHallucinations("Patient has sore throat. No vitals taken.", prediction);
    expect(hallucinations.some((item) => item.path === "vitals.hr")).toBe(true);
  });

  test("hallucination detector accepts supported values", () => {
    const prediction: ClinicalExtraction = { ...base, vitals: { ...base.vitals, hr: 88 } };
    const hallucinations = detectHallucinations("Vitals: HR 88.", prediction);
    expect(hallucinations.some((item) => item.path === "vitals.hr")).toBe(false);
  });

  test("hallucination detector accepts supported paraphrased plan items", () => {
    const prediction: ClinicalExtraction = { ...base, chief_complaint: "stress", plan: ["stress reduction counseling"] };
    const hallucinations = detectHallucinations("Let's look at the drivers: stress reduction, posture, and sleep.", prediction);
    expect(hallucinations).toHaveLength(0);
  });

  test("hallucination detector accepts inferred oral route from take wording", () => {
    const prediction: ClinicalExtraction = {
      ...base,
      medications: [{ name: "ibuprofen", dose: "400 mg", frequency: "every 6 hours as needed", route: "PO" }],
    };
    const hallucinations = detectHallucinations("Take ibuprofen 400 mg q6h PRN.", prediction);
    expect(hallucinations.some((item) => item.path === "medications.0.route")).toBe(false);
    expect(hallucinations.some((item) => item.path === "medications.0.frequency")).toBe(false);
  });

  test("follow-up null truth table penalizes invented interval", () => {
    const gold: ClinicalExtraction = { ...base, follow_up: { interval_days: null, reason: null } };
    const prediction: ClinicalExtraction = { ...base, follow_up: { interval_days: 7, reason: null } };
    const score = evaluateCase({ transcriptId: "tiny", transcript: "No follow-up needed.", prediction, gold, schemaValid: true });
    expect(score.fieldScores.follow_up.details?.intervalScore).toBe(0);
  });

  test("all-null gold vitals penalize invented vitals", () => {
    const gold: ClinicalExtraction = { ...base, vitals: { bp: null, hr: null, temp_f: null, spo2: null } };
    const prediction: ClinicalExtraction = { ...base, vitals: { bp: null, hr: 88, temp_f: null, spo2: null } };
    const score = evaluateCase({ transcriptId: "tiny", transcript: "No vitals taken.", prediction, gold, schemaValid: true });
    expect(score.fieldScores.vitals.score).toBe(0);
  });
});
