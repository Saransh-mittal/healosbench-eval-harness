import Ajv2020 from "ajv/dist/2020";
import type { ClinicalExtraction } from "@test-evals/shared";
import type { ValidationResult } from "@test-evals/llm";

export function createExtractionValidator(schema: Record<string, unknown>) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  return (value: unknown): ValidationResult => {
    const ok = validate(value);
    if (ok) return { ok: true, value: value as ClinicalExtraction };
    return {
      ok: false,
      errors:
        validate.errors?.map((error) => {
          const path = error.instancePath || "/";
          return `${path} ${error.message ?? "is invalid"}`;
        }) ?? ["unknown schema validation error"],
    };
  };
}
