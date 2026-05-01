import type { CaseScore, ClinicalExtraction, FieldScore, FieldScores, Hallucination } from "@test-evals/shared";

import {
  fuzzyMatch,
  normalizeBp,
  normalizeDose,
  normalizeFrequency,
  normalizeText,
  routeHasSupport,
  frequencyHasSupport,
  timePhraseToDays,
  tokenSetRatio,
  transcriptHasSupport,
} from "./normalizers";

function clampScore(score: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(score) ? score : 0));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function setF1<T>(
  predicted: T[],
  gold: T[],
  match: (pred: T, gold: T) => boolean,
): FieldScore & { matches: Array<[number, number]> } {
  if (predicted.length === 0 && gold.length === 0) {
    return { score: 1, precision: 1, recall: 1, f1: 1, matches: [] };
  }
  const usedGold = new Set<number>();
  const matches: Array<[number, number]> = [];

  predicted.forEach((predItem, predIndex) => {
    const goldIndex = gold.findIndex((goldItem, index) => !usedGold.has(index) && match(predItem, goldItem));
    if (goldIndex >= 0) {
      usedGold.add(goldIndex);
      matches.push([predIndex, goldIndex]);
    }
  });

  const precision = predicted.length === 0 ? 0 : matches.length / predicted.length;
  const recall = gold.length === 0 ? 0 : matches.length / gold.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { score: f1, precision, recall, f1, matches };
}

function scoreVitals(prediction: ClinicalExtraction, gold: ClinicalExtraction): FieldScore {
  const subScores: Record<string, number> = {};
  const goldVitals = gold.vitals;
  const predVitals = prediction.vitals;
  const scored: number[] = [];

  if (goldVitals.bp !== null) {
    const score = normalizeBp(predVitals.bp) === normalizeBp(goldVitals.bp) ? 1 : 0;
    subScores.bp = score;
    scored.push(score);
  }
  if (goldVitals.hr !== null) {
    const score = predVitals.hr === goldVitals.hr ? 1 : 0;
    subScores.hr = score;
    scored.push(score);
  }
  if (goldVitals.temp_f !== null) {
    const score = predVitals.temp_f !== null && Math.abs(predVitals.temp_f - goldVitals.temp_f) <= 0.2 ? 1 : 0;
    subScores.temp_f = score;
    scored.push(score);
  }
  if (goldVitals.spo2 !== null) {
    const score = predVitals.spo2 === goldVitals.spo2 ? 1 : 0;
    subScores.spo2 = score;
    scored.push(score);
  }

  if (scored.length === 0) {
    const invented = Object.values(predVitals).some((value) => value !== null);
    return { score: invented ? 0 : 1, details: { subScores, allGoldVitalsNull: true } };
  }

  return { score: average(scored), details: { subScores } };
}

function medsMatch(pred: ClinicalExtraction["medications"][number], gold: ClinicalExtraction["medications"][number]): boolean {
  return (
    fuzzyMatch(pred.name, gold.name) &&
    normalizeDose(pred.dose) === normalizeDose(gold.dose) &&
    normalizeFrequency(pred.frequency) === normalizeFrequency(gold.frequency)
  );
}

function scoreDiagnoses(prediction: ClinicalExtraction, gold: ClinicalExtraction): FieldScore {
  const f1 = setF1(prediction.diagnoses, gold.diagnoses, (pred, goldItem) =>
    fuzzyMatch(pred.description, goldItem.description),
  );
  const icdMatches = f1.matches.filter(([predIndex, goldIndex]) => {
    const predCode = prediction.diagnoses[predIndex]?.icd10;
    const goldCode = gold.diagnoses[goldIndex]?.icd10;
    return predCode !== undefined && goldCode !== undefined && predCode === goldCode;
  }).length;
  const icd10MatchRate = f1.matches.length === 0 ? 0 : icdMatches / f1.matches.length;
  return {
    ...f1,
    score: clampScore(f1.score + 0.1 * icd10MatchRate),
    details: { icd10MatchRate },
  };
}

function scoreFollowUp(prediction: ClinicalExtraction, gold: ClinicalExtraction): FieldScore {
  const predInterval = prediction.follow_up.interval_days;
  const goldInterval = gold.follow_up.interval_days;
  const intervalScore =
    predInterval === null && goldInterval === null
      ? 1
      : predInterval === null || goldInterval === null
        ? 0
        : predInterval === goldInterval
          ? 1
          : 0;

  const predReason = prediction.follow_up.reason;
  const goldReason = gold.follow_up.reason;
  const reasonScore =
    predReason === null && goldReason === null
      ? 1
      : predReason === null || goldReason === null
        ? 0
        : tokenSetRatio(predReason, goldReason);

  return { score: average([intervalScore, reasonScore]), details: { intervalScore, reasonScore } };
}

function valueCandidates(prediction: ClinicalExtraction): Array<{ path: string; value: string; exempt?: boolean }> {
  const values: Array<{ path: string; value: string; exempt?: boolean }> = [
    { path: "chief_complaint", value: prediction.chief_complaint },
  ];
  Object.entries(prediction.vitals).forEach(([key, value]) => {
    if (value !== null) values.push({ path: `vitals.${key}`, value: String(value) });
  });
  prediction.medications.forEach((med, index) => {
    values.push({ path: `medications.${index}.name`, value: med.name });
    if (med.dose) values.push({ path: `medications.${index}.dose`, value: med.dose });
    if (med.frequency) values.push({ path: `medications.${index}.frequency`, value: med.frequency });
    if (med.route) values.push({ path: `medications.${index}.route`, value: med.route });
  });
  prediction.diagnoses.forEach((diagnosis, index) => {
    values.push({ path: `diagnoses.${index}.description`, value: diagnosis.description });
    if (diagnosis.icd10) values.push({ path: `diagnoses.${index}.icd10`, value: diagnosis.icd10, exempt: true });
  });
  prediction.plan.forEach((item, index) => values.push({ path: `plan.${index}`, value: item }));
  if (prediction.follow_up.interval_days !== null) {
    values.push({ path: "follow_up.interval_days", value: `${prediction.follow_up.interval_days} days` });
  }
  if (prediction.follow_up.reason) values.push({ path: "follow_up.reason", value: prediction.follow_up.reason });
  return values;
}

export function detectHallucinations(transcript: string, prediction: ClinicalExtraction): Hallucination[] {
  const hallucinations: Hallucination[] = [];
  for (const candidate of valueCandidates(prediction)) {
    if (candidate.exempt) continue;
    const normalized = normalizeText(candidate.value);
    const supported = candidate.path.endsWith(".route")
      ? routeHasSupport(transcript, candidate.value)
      : candidate.path.endsWith(".frequency")
        ? frequencyHasSupport(transcript, candidate.value)
        : candidate.path === "follow_up.interval_days"
          ? timePhraseToDays(transcript) === Number.parseInt(candidate.value, 10) ||
            transcriptHasSupport(transcript, candidate.value)
          : transcriptHasSupport(transcript, normalized);
    if (!supported) {
      hallucinations.push({
        path: candidate.path,
        value: candidate.value,
        reason: "No normalized substring or fuzzy transcript-window support found.",
      });
    }
  }
  return hallucinations;
}

export function evaluateCase(args: {
  transcriptId: string;
  transcript: string;
  prediction: ClinicalExtraction | null;
  gold: ClinicalExtraction;
  schemaValid: boolean;
}): CaseScore {
  if (!args.prediction) {
    const zero = { score: 0 };
    return {
      transcriptId: args.transcriptId,
      fieldScores: {
        chief_complaint: zero,
        vitals: zero,
        medications: zero,
        diagnoses: zero,
        plan: zero,
        follow_up: zero,
      },
      macroScore: 0,
      hallucinations: [],
      schemaValid: args.schemaValid,
    };
  }

  const medications = setF1(args.prediction.medications, args.gold.medications, medsMatch);
  const plan = setF1(args.prediction.plan, args.gold.plan, fuzzyMatch);
  const fieldScores: FieldScores = {
    chief_complaint: { score: tokenSetRatio(args.prediction.chief_complaint, args.gold.chief_complaint) },
    vitals: scoreVitals(args.prediction, args.gold),
    medications,
    diagnoses: scoreDiagnoses(args.prediction, args.gold),
    plan,
    follow_up: scoreFollowUp(args.prediction, args.gold),
  };
  const macroScore = average(Object.values(fieldScores).map((field) => field.score));

  return {
    transcriptId: args.transcriptId,
    fieldScores,
    macroScore,
    hallucinations: detectHallucinations(args.transcript, args.prediction),
    schemaValid: args.schemaValid,
  };
}

export function summarizeScores(cases: CaseScore[]) {
  const fields = ["chief_complaint", "vitals", "medications", "diagnoses", "plan", "follow_up"] as const;
  const fieldScores = Object.fromEntries(
    fields.map((field) => [field, average(cases.map((item) => item.fieldScores[field].score))]),
  ) as Record<(typeof fields)[number], number>;
  return {
    macroFieldScore: average(Object.values(fieldScores)),
    averageCaseScore: average(cases.map((item) => item.macroScore)),
    fieldScores,
    schemaFailureRate: cases.length === 0 ? 0 : cases.filter((item) => !item.schemaValid).length / cases.length,
    hallucinationCount: cases.reduce((sum, item) => sum + item.hallucinations.length, 0),
  };
}
