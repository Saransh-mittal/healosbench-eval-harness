import type { PromptStrategy } from "@test-evals/shared";

import { hashObject } from "./hash";

export const TOOL_NAME = "record_clinical_extraction";

const BASE_RULES = `You extract structured clinical facts from fully synthetic doctor-patient transcripts.

Rules:
- Use only facts supported by the transcript.
- Return null for absent vitals or follow-up fields.
- Preserve clinically relevant medication dose, route, and frequency.
- Split plan into discrete actionable items.
- Use concise diagnosis descriptions.
- Do not invent vitals, medications, diagnoses, ICD-10 codes, or follow-up details.
- The final answer must be a ${TOOL_NAME} tool call.`;

const CACHED_EXTRACTION_RUBRIC = `Stable extraction rubric for all runs:

Chief complaint:
- Extract the main reason the patient came in, usually stated near the beginning of the visit.
- Prefer a concise clinical phrase over a long sentence.
- Include duration when clearly stated, such as "for four days", "for two weeks", or "since yesterday".
- Do not include unrelated background diseases unless they are the reason for the encounter.
- If multiple symptoms form one presentation, keep them together, such as "sore throat and nasal congestion".
- If the visit is follow-up for a known disease, phrase the complaint as the follow-up reason, such as "diabetes follow-up".
- Do not rewrite a clearly acute complaint as a diagnosis unless the transcript frames it that way.

Vitals:
- Vitals may appear in bracketed intake text, nurse text, or doctor speech.
- Blood pressure must be systolic/diastolic only, with no units.
- Heart rate is beats per minute as an integer.
- Temperature is Fahrenheit as a number.
- Oxygen saturation is percent as an integer.
- If a vital is not present, use null.
- Do not infer normal vitals from phrases like "looks well", "breathing comfortably", or "no distress".
- Do not copy historical vitals unless they were taken or reviewed as part of this visit.
- If the patient reports a home fever but the schema asks temp_f, only extract it when a numeric Fahrenheit temperature is stated.
- If two vitals conflict, prefer the current intake vitals for the visit.

Medications:
- Include medications discussed in the encounter: existing medications, started medications, stopped medications, changed medications, and recommended OTC medications.
- Do not include medication allergies as medications.
- Do not include vaccines as medications unless the clinician explicitly treats them as an administered medication in the plan.
- Medication name should be the drug or product name without dose.
- Dose should contain strength or amount only, such as "400 mg", "2 puffs", or "10 units".
- Frequency should contain schedule only, such as "twice daily", "every 6 hours as needed", or "daily".
- Route should be a short route when present: PO, IV, IM, topical, inhaled, SL, PR.
- Use null for dose, frequency, or route when missing.
- Preserve PRN/as-needed instructions in frequency.
- If a medication is stopped, still include it because it was discussed in the encounter.
- If a medication is only mentioned as a past failed therapy and no current action is taken, omit it unless clinically central to this encounter.
- If an antibiotic is requested but denied, do not include the antibiotic unless named and discussed as a medication plan.
- Normalize "by mouth", "oral", and "orally" to PO when route is clear.
- Normalize inhaler delivery to inhaled when route is clear.

Diagnoses:
- Include working and confirmed diagnoses made during this encounter.
- Use concise descriptions such as "viral upper respiratory infection", "hypertension", or "type 2 diabetes mellitus".
- Do not invent diagnoses from symptoms alone if the clinician does not diagnose them.
- If the clinician says "likely", "consistent with", or "looks like", that is a working diagnosis and should be included.
- If no ICD-10 code is stated, include one only when it is highly standard for the diagnosis; otherwise omit the icd10 property.
- Never use non-ICD strings in the icd10 field.
- Do not put symptoms in diagnoses when they are better represented as chief complaint unless the clinician names the symptom as the diagnosis.
- If multiple diagnoses are discussed but only one is assessed today, include the ones relevant to today's encounter.

Plan:
- Split the plan into discrete actions, one action per string.
- Include tests, imaging, referrals, counseling, medication changes, lifestyle advice, return precautions, and monitoring instructions.
- Keep each plan item concise but specific enough to compare against gold.
- Do not duplicate medication instructions if the same medication plan is already represented in an identical plan string unless it is a distinct action.
- Include negative plans when clinically meaningful, such as "no antibiotics because likely viral".
- Include return precautions such as "call if fever above 102" or "go to ER for chest pain".
- Do not include small talk or patient agreement as plan.
- Do not add generic medical advice that was not in the transcript.

Follow-up:
- Follow-up is only scheduled or conditional return timing.
- interval_days is an integer when a concrete interval is stated.
- one day = 1, two days = 2, one week = 7, two weeks = 14, one month = 30, six months = 180, one year = 365.
- Use null interval_days when follow-up is "as needed", "if worse", "if not improving", or no fixed date is scheduled.
- reason should capture why follow-up is needed, such as "blood pressure recheck", "review lab results", or "return only if symptoms worsen".
- If no follow-up is needed, use interval_days null and reason reflecting that only if stated.
- Do not invent routine follow-up timing.

Grounding discipline:
- Every non-null value should be traceable to the transcript.
- Numeric values must come from explicit numbers in the transcript or a direct time conversion for follow-up.
- Do not use outside medical knowledge to add missing vitals, medication doses, or plans.
- Do not infer route unless the wording implies it, such as "take" usually implying PO and "inhaler" implying inhaled.
- Do not infer frequency from dose alone.
- Do not infer a diagnosis solely from a medication.
- Do not convert vague terms like "soon", "later", or "in a bit" to interval_days.
- Do not add ICD-10 codes for uncertain or very broad descriptions unless the mapping is obvious and stable.

Output discipline:
- Always call the tool exactly once for the final extraction.
- Do not return prose instead of the tool call.
- Keep arrays empty when there are no values.
- Use null for missing nullable scalar fields.
- Do not add properties outside the schema.
- Do not omit required properties.
- Make strings concise and comparable.

The above rubric is intentionally stable and reused across cases so prompt caching can verify that repeated evaluations reuse the same prefix.`;

const CACHED_NORMALIZATION_LEXICON = `Stable clinical normalization lexicon:

Common symptom wording:
- sore throat, throat pain, scratchy throat, painful swallowing are similar chief-complaint phrases.
- nasal congestion, stuffy nose, blocked nose, rhinorrhea, runny nose are upper-respiratory symptom phrases.
- cough, dry cough, productive cough, nighttime cough should preserve the important qualifier when it is central.
- shortness of breath, dyspnea, trouble breathing, winded, SOB can refer to breathing symptoms.
- chest pain, chest pressure, chest tightness, CP can refer to chest symptoms; do not diagnose cardiac disease from this alone.
- abdominal pain, belly pain, stomach pain, epigastric pain should preserve location when stated.
- dysuria, burning with urination, urinary burning can refer to urinary symptoms.
- headache, migraine, head pain should preserve severity/duration when stated.
- dizziness, lightheadedness, vertigo are not always identical; preserve the clinician's framing.

Common diagnosis wording:
- viral URI, viral upper respiratory infection, common cold can match when the clinician frames them that way.
- acute otitis media and ear infection can match when the encounter clearly diagnoses a middle-ear infection.
- allergic rhinitis and seasonal allergies can match when the clinician diagnoses allergies.
- hypertension and high blood pressure can match when the clinician diagnoses or follows hypertension.
- type 2 diabetes mellitus and T2DM can match.
- asthma exacerbation and asthma flare can match.
- COPD exacerbation and COPD flare can match.
- gastroesophageal reflux disease and GERD can match.
- urinary tract infection and UTI can match.
- sinusitis and sinus infection can match only if diagnosed, not merely congestion.

Medication frequency details:
- BID, bid, twice daily, twice a day, two times daily are equivalent.
- TID, tid, three times daily, three times a day are equivalent.
- QID, qid, four times daily, four times a day are equivalent.
- qAM means every morning; qPM means every evening; qHS means at bedtime.
- q4h means every 4 hours; q6h means every 6 hours; q8h means every 8 hours; q12h means every 12 hours.
- PRN, prn, as needed, when needed are equivalent.
- daily, once daily, every day, once a day are equivalent.
- weekly, once weekly, once a week are equivalent.
- every other day and qod are equivalent.
- before meals, with meals, after meals, and at bedtime are frequency qualifiers and should stay in frequency.

Medication dose and route details:
- mg, milligram, milligrams are normalized as mg.
- mcg, microgram, micrograms are normalized as mcg.
- g, gram, grams are normalized as g.
- mL, ml, milliliter, milliliters are normalized as mL.
- units and unit are normalized as units.
- puffs, puff, sprays, spray, drops, drop, tablets, tablet, capsules, capsule may be dose units.
- PO, by mouth, oral, orally are equivalent routes.
- IV and intravenous are equivalent routes.
- IM and intramuscular are equivalent routes.
- SL and sublingual are equivalent routes.
- PR and rectal are equivalent routes.
- topical means applied to skin or affected area.
- inhaled means inhaler/nebulized delivery.

Follow-up time details:
- tomorrow is 1 day only when follow-up is explicitly tomorrow.
- in 48 hours is 2 days.
- in 72 hours is 3 days.
- one week is 7 days, two weeks is 14 days, three weeks is 21 days, four weeks is 28 days.
- one month is 30 days, two months is 60 days, three months is 90 days, six months is 180 days.
- annual or yearly follow-up is 365 days when explicitly scheduled.
- "call if not improving in 7 days" is usually a conditional return precaution, not a scheduled follow-up; interval_days can remain null if no fixed appointment is scheduled.
- "follow up in 2 weeks" is scheduled follow-up and should set interval_days 14.

Return precaution details:
- call if worse, return if worsening, seek care if symptoms worsen are plan/return precaution ideas.
- ER precautions, emergency department if chest pain, go to ER for severe shortness of breath are plan items.
- fever above a stated threshold should preserve that threshold.
- not improving after a stated number of days should preserve that number.

Null handling reminders:
- Missing vitals are null, not normal values.
- Missing medication dose is null, not a guessed common dose.
- Missing medication frequency is null, not daily.
- Missing route is null unless wording implies route.
- Missing follow-up interval is null.
- Missing follow-up reason is null.
- Empty arrays are valid when no medications, diagnoses, or plan items are present.

Scoring-aware phrasing:
- Use one item per medication.
- Use one item per diagnosis.
- Use one item per discrete plan action.
- Avoid combining unrelated plan items into one long sentence.
- Avoid splitting one medication instruction into several medication objects.
- Avoid making chief_complaint so broad that it loses the symptom and duration.
- Prefer "supportive care with fluids and saline nasal spray" over vague "supportive care" when those details appear.
- Prefer "ibuprofen 400 mg every 6 hours as needed" over vague "pain medication" when stated.
- Prefer "return only if symptoms worsen" over vague "follow up as needed" when the transcript states worsening symptoms.

This lexicon is static, generic, synthetic-data-safe, and does not contain gold answers for the eval cases.`;

const CACHED_FIELD_CHECKLIST = `Stable field-by-field checklist:

Before tool call, verify chief_complaint:
- Is there a symptom, disease follow-up, medication issue, lab review, injury, or preventive reason?
- Is the phrase short enough to compare but specific enough to preserve the visit reason?
- Did you avoid adding diagnoses not stated by the clinician?
- Did you preserve duration only when stated?
- Did you avoid copying the whole opening conversation?

Before tool call, verify vitals:
- bp matches only a pattern like 122/78.
- hr is an integer and not confused with age, days, or oxygen saturation.
- temp_f is Fahrenheit and not Celsius.
- spo2 is an oxygen percentage and not a heart rate.
- null is used for every missing vital.
- intake vitals are preferred over patient guesses.

Before tool call, verify medications:
- Each medication object has name, dose, frequency, route keys.
- Unknown dose/frequency/route is null, not an empty string.
- Dose does not contain frequency.
- Frequency does not contain dose.
- Route is short and normalized where obvious.
- PRN stays with frequency.
- Stopped or changed meds are included if discussed as part of today's management.
- Denied antibiotics are not included as active medication unless explicitly named as discussed/stopped.

Before tool call, verify diagnoses:
- Each diagnosis object has description.
- icd10 is omitted if unknown, not null.
- Diagnosis descriptions are not entire assessment paragraphs.
- Symptoms are not promoted to diagnoses unless the clinician does so.
- Working diagnoses are allowed when the clinician states likely/consistent with.

Before tool call, verify plan:
- Plan is an array of concise strings.
- Medication changes in the plan can also be reflected as medications.
- Testing/imaging/referrals are included.
- Return precautions are included.
- Lifestyle instructions are included when specific.
- Do not add routine boilerplate.
- Avoid duplicate plan items.

Before tool call, verify follow_up:
- interval_days is null for conditional-only return.
- interval_days is set for scheduled clinic follow-up.
- reason is null when no reason is stated.
- reason should not be a long plan paragraph.
- Time conversion is direct and conservative.

Common extraction traps:
- A patient asking for antibiotics is not the same as antibiotics being prescribed.
- A patient saying they felt warm is not a numeric fever unless a number is given.
- "Lungs sound fine" is exam information, not a diagnosis.
- "No need for follow-up unless worse" is conditional follow-up, not scheduled follow-up.
- "Call us if not improving in 7 days" is a return precaution; it may be a plan item while interval_days remains null.
- "Continue current medication" includes the medication only if the medication name is stated.
- "Take two tablets" is a dose only if the medication and tablet strength or amount are clear.
- "Negative rapid strep" is a test result, not a diagnosis.
- "Likely viral" is often enough for viral diagnosis if the clinician states it.
- "Rule out" language is not a confirmed diagnosis.

Canonical output style:
- Use lowercase clinical descriptions unless a proper name or code requires uppercase.
- Keep medication names lowercase unless brand capitalization is clear.
- Use PO, IV, IM, SL, PR route abbreviations when obvious.
- Keep bp as string.
- Keep hr and spo2 as integers.
- Keep temp_f as number.
- Keep interval_days as integer.
- Omit optional icd10 when not known.

Static examples of format only, not eval answers:
- A chief complaint should look like "cough and wheezing for three days" rather than "the patient is here because they have been having a cough and they are worried".
- A medication should look like {"name":"albuterol","dose":"2 puffs","frequency":"every 4 hours as needed","route":"inhaled"}.
- A follow-up should look like {"interval_days":14,"reason":"blood pressure recheck"} when scheduled.
- A conditional follow-up should look like {"interval_days":null,"reason":"return only if symptoms worsen"} when no appointment is scheduled.

This checklist is stable across all cases and strategies. It is generic guidance, not case-specific memory.`;

const NORMALIZATION_REFERENCE = `Stable normalization reference:
- BID = twice daily = two times daily.
- TID = three times daily.
- QID = four times daily.
- q6h = every 6 hours; q8h = every 8 hours.
- PRN = as needed.
- PO = oral/by mouth; IV = intravenous; IM = intramuscular; SL = sublingual.
- Write doses with a space between number and unit, e.g. 10 mg.
- Convert follow-up phrases only when explicit: one week=7 days, two weeks=14 days, one month=30 days.`;

const FEW_SHOT_BLOCK = `Few-shot examples, all synthetic and not part of the eval set:

Transcript: Patient has asthma flare. Vitals BP 118/74 HR 92 Temp 98.7 SpO2 95%. Continue albuterol inhaler 2 puffs every 4 hours PRN. Start prednisone 40 mg PO daily for 5 days. Follow up in one week for breathing check.
Extraction: chief complaint asthma flare; vitals complete; medications albuterol 2 puffs every 4 hours as needed inhaled and prednisone 40 mg daily PO; diagnosis asthma exacerbation; plan includes steroid burst and rescue inhaler; follow_up interval_days 7 reason breathing check.

Transcript: Patient reports knee pain. No vitals were taken. Use ice, rest, and ibuprofen 400mg by mouth q6h PRN. Return only if worsening.
Extraction: vitals all null; medication ibuprofen 400 mg every 6 hours as needed PO; diagnosis knee pain; follow_up interval_days null reason return only if symptoms worsen.

Transcript: Diabetes visit. BP 134/82. A1c high. Increase metformin to 1000 mg PO BID. See clinic in two weeks.
Extraction: missing HR/temp/SpO2 are null; medication metformin 1000 mg twice daily PO; diagnosis type 2 diabetes mellitus; follow_up interval_days 14.`;

export interface PromptSpec {
  strategy: PromptStrategy;
  system: string;
  promptHash: string;
}

export function buildPrompt(strategy: PromptStrategy, toolSchema: unknown): PromptSpec {
  const system =
    strategy === "zero_shot"
      ? `${BASE_RULES}\n\n${CACHED_EXTRACTION_RUBRIC}\n\n${CACHED_NORMALIZATION_LEXICON}\n\n${CACHED_FIELD_CHECKLIST}`
      : strategy === "few_shot"
        ? `${BASE_RULES}\n\n${CACHED_EXTRACTION_RUBRIC}\n\n${CACHED_NORMALIZATION_LEXICON}\n\n${CACHED_FIELD_CHECKLIST}\n\n${NORMALIZATION_REFERENCE}\n\n${FEW_SHOT_BLOCK}`
        : `${BASE_RULES}\n\n${CACHED_EXTRACTION_RUBRIC}\n\n${CACHED_NORMALIZATION_LEXICON}\n\n${CACHED_FIELD_CHECKLIST}\n\n${NORMALIZATION_REFERENCE}\n\nFor this strategy, first produce a concise private extraction scratchpad, then use it to make the required tool call.`;

  const promptHash = hashObject({
    strategy,
    system,
    toolName: TOOL_NAME,
    toolSchema,
  });

  return { strategy, system, promptHash };
}
