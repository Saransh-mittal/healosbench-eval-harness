# HEALOSBENCH Run run_35436079-8aa8-4813-9c7c-c1934d1bfe6a

Strategy: few_shot
Model: claude-haiku-4-5-20251001
Prompt hash: 524c2ee4f222360bf03e2c89d3ed76f21970489ce59a8c80c502f66a9353496f

| Metric | Value |
| --- | ---: |
| Macro field score | 0.691 |
| Average case score | 0.691 |
| Schema failure rate | 0.0% |
| Hallucinations | 118 |
| Cost USD | $0.1891 |
| Cache read ratio | 0.995 |

## Field Scores

- chief_complaint: 0.637
- vitals: 1.000
- medications: 0.654
- diagnoses: 0.695
- plan: 0.438
- follow_up: 0.721

## Worst 5 Cases

- case_038: 0.408, hallucinations=1, schemaValid=true
- case_030: 0.477, hallucinations=3, schemaValid=true
- case_029: 0.487, hallucinations=7, schemaValid=true
- case_003: 0.511, hallucinations=0, schemaValid=true
- case_032: 0.523, hallucinations=0, schemaValid=true
