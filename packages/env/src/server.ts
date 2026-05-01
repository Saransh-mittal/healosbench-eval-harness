import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1).default("postgres://postgres:postgres@localhost:5432/healosbench"),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    BETTER_AUTH_SECRET: z.string().min(32).default("dev-secret-dev-secret-dev-secret-dev-secret"),
    BETTER_AUTH_URL: z.url().default("http://localhost:8787"),
    CORS_ORIGIN: z.url().default("http://localhost:3001"),
    EVAL_COST_CAP_USD: z.coerce.number().positive().optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
