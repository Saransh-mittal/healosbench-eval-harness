# HEALOSBENCH Notes

## Methodology

The harness compares prompt strategies with stable prompt hashes, Anthropic tool use, JSON Schema validation, retry-with-error-feedback, prompt caching metrics, and field-specific scoring. The model never reads previous eval results; generated `results/<run_id>/SUMMARY.md` files are human-only run artifacts.

## Strategies

- `zero_shot`: schema/tool instructions only.
- `few_shot`: cached normalization reference plus synthetic examples outside the 50-case eval set.
- `cot`: two-stage extraction with a scratchpad call followed by a required tool call. Only the tool payload is evaluated.

CoT should have a lower cache-read ratio than the single-call strategies because its second call includes per-case scratchpad text. The dashboard reports cache-read ratio, not just absolute cache-read tokens, so this does not look like broken caching.

Haiku 4.5 requires at least 4096 cacheable prompt tokens before prompt caching activates. Shorter cached prefixes are silently processed without cache writes or reads. To make caching measurable, the static prefix includes a stable extraction rubric, normalization lexicon, field checklist, and tool schema; the runner processes the first case before launching concurrent cases so later cases can read the warmed cache.

## Metrics

- Chief complaint: normalized token-set fuzzy score.
- Vitals: score non-null gold vitals; exact match except `temp_f` within ±0.2 F. If all gold vitals are null, invented vitals score the vitals field as 0 and can also be hallucination-flagged.
- Medications: set precision/recall/F1 with fuzzy name >= 0.85 plus normalized dose and frequency equality.
- Diagnoses: `min(1.0, description_f1 + 0.1 * icd10_match_rate)`.
- Plan: fuzzy set-F1.
- Follow-up: exact/null-aware `interval_days`, fuzzy/null-aware `reason`.

The fuzzy threshold is 0.85 because it is conservative enough to allow formatting variants such as `10mg` vs `10 mg`, while avoiding clinically different terms that merely share a few letters. The compare winner threshold is 0.03 so tiny aggregate movement does not masquerade as a decisive strategy win.

Invented vitals and follow-up intervals can receive a double signal: lower field score and hallucination flag. That is intentional because score mismatch and lack of transcript support are distinct production risks.

## Rate Limits

Runs use a max-5 semaphore. On Anthropic 429/529 responses, the runner honors `retry-after` when present; otherwise it uses exponential backoff with jitter. The run case remains resumable from the latest persisted state.

## Current Run Results

Full 50-case run completed with:

```bash
bun run eval -- --strategy=all --model=claude-haiku-4-5-20251001
```

| Strategy | Run ID | Macro | Case Avg | Chief | Vitals | Meds | Diagnoses | Plan | Follow-up | Schema Fail | Hallucinations | Cache Read Tokens | Cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| zero_shot | run_a4284509-537c-4b46-aece-5f2d12c113e4 | 0.704 | 0.704 | 0.625 | 0.980 | 0.762 | 0.635 | 0.494 | 0.729 | 0.0% | 108 | 238337 | $0.1636 |
| few_shot | run_35436079-8aa8-4813-9c7c-c1934d1bfe6a | 0.691 | 0.691 | 0.637 | 1.000 | 0.654 | 0.695 | 0.438 | 0.721 | 0.0% | 118 | 268032 | $0.1891 |
| cot | run_18e480f7-3008-4ef9-8425-d1bb2b855fea | 0.678 | 0.678 | 0.626 | 0.980 | 0.664 | 0.633 | 0.444 | 0.718 | 0.0% | 133 | 467273 | $0.4123 |

Zero-shot wins overall by the 0.03 threshold against CoT, and is a tie against few-shot on aggregate because the delta is 0.013. Few-shot wins diagnoses and vitals, but loses medication and plan extraction. CoT was most expensive because it performs a scratchpad call plus tool call.

## Cuts

The implementation intentionally skips RAG/wiki context, multi-user eval auth, prompt diff UI, active-learning hints, and visual polish. The compare view keeps the grading-critical table: per-field deltas, winner/tie labels, case-win counts, schema-failure signal, and hallucination delta.
