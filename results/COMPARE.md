# HEALOSBENCH Compare

Full command:

```bash
bun run eval -- --strategy=all --model=claude-haiku-4-5-20251001
```

| Strategy | Run ID | Macro | Schema Fail | Hallucinations | Cache Read Tokens | Cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| zero_shot | run_a4284509-537c-4b46-aece-5f2d12c113e4 | 0.704 | 0.0% | 108 | 238337 | $0.1636 |
| few_shot | run_35436079-8aa8-4813-9c7c-c1934d1bfe6a | 0.691 | 0.0% | 118 | 268032 | $0.1891 |
| cot | run_18e480f7-3008-4ef9-8425-d1bb2b855fea | 0.678 | 0.0% | 133 | 467273 | $0.4123 |

## Field Scores

| Field | zero_shot | few_shot | cot | Winner |
| --- | ---: | ---: | ---: | --- |
| chief_complaint | 0.625 | 0.637 | 0.626 | tie |
| vitals | 0.980 | 1.000 | 0.980 | tie |
| medications | 0.762 | 0.654 | 0.664 | zero_shot |
| diagnoses | 0.635 | 0.695 | 0.633 | few_shot |
| plan | 0.494 | 0.438 | 0.444 | zero_shot |
| follow_up | 0.729 | 0.721 | 0.718 | tie |

Winner rule: a field needs an absolute delta above 0.03 to be called a winner; otherwise it is a tie.
