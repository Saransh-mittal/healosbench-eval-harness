import { createRunRequestSchema, promptStrategySchema } from "@test-evals/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { compareRuns, getCaseDetail, getRunDetail, listRuns } from "../services/results.service";
import { resumeEval, runEval, runStrategies } from "../services/runner.service";
import { runEvents } from "../services/events.service";

export const runsRoute = new Hono();

runsRoute.get("/", async (c) => c.json(await listRuns()));

runsRoute.post("/", async (c) => {
  const body = createRunRequestSchema.parse(await c.req.json());
  if (body.strategy === "all") {
    const runIds = await runStrategies(body);
    return c.json({ runIds });
  }
  const strategy = promptStrategySchema.parse(body.strategy);
  const runId = await runEval({ ...body, strategy });
  return c.json({ runId });
});

runsRoute.get("/compare", async (c) => {
  const left = c.req.query("left");
  const right = c.req.query("right");
  if (!left || !right) return c.json({ error: "left and right query params are required" }, 400);
  const compare = await compareRuns(left, right);
  if (!compare) return c.json({ error: "Run not found" }, 404);
  return c.json(compare);
});

runsRoute.get("/:id", async (c) => {
  const detail = await getRunDetail(c.req.param("id"));
  if (!detail) return c.json({ error: "Run not found" }, 404);
  return c.json(detail);
});

runsRoute.post("/:id/resume", async (c) => {
  const aggregate = await resumeEval(c.req.param("id"));
  return c.json({ aggregate });
});

runsRoute.get("/:id/cases/:transcriptId", async (c) => {
  const detail = await getCaseDetail(c.req.param("id"), c.req.param("transcriptId"));
  if (!detail) return c.json({ error: "Case not found" }, 404);
  return c.json(detail);
});

runsRoute.get("/:id/events", (c) => {
  const runId = c.req.param("id");
  return streamSSE(c, async (stream) => {
    const unsubscribe = runEvents.subscribe(runId, (event) => {
      void stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      });
    });
    stream.onAbort(unsubscribe);
    await stream.writeSSE({ event: "connected", data: JSON.stringify({ runId }) });
    while (!stream.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      await stream.writeSSE({ event: "ping", data: "{}" });
    }
  });
});
