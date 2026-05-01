# HEALOSBENCH Run run_a4284509-537c-4b46-aece-5f2d12c113e4

Strategy: zero_shot
Model: claude-haiku-4-5-20251001
Prompt hash: 3ad826eb150b4a84ac1783a63887a270bb3a062d2d65dc0018b528617639193a

| Metric | Value |
| --- | ---: |
| Macro field score | 0.704 |
| Average case score | 0.704 |
| Schema failure rate | 0.0% |
| Hallucinations | 108 |
| Cost USD | $0.1636 |
| Cache read ratio | 0.995 |

## Field Scores

- chief_complaint: 0.625
- vitals: 0.980
- medications: 0.762
- diagnoses: 0.635
- plan: 0.494
- follow_up: 0.729

## Worst 5 Cases

- case_039: 0.451, hallucinations=1, schemaValid=true
- case_030: 0.479, hallucinations=2, schemaValid=true
- case_014: 0.493, hallucinations=1, schemaValid=true
- case_038: 0.504, hallucinations=2, schemaValid=true
- case_004: 0.554, hallucinations=2, schemaValid=true
