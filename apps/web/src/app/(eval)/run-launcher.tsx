"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

type Strategy = "zero_shot" | "few_shot" | "cot";

export default function RunLauncher() {
  const router = useRouter();
  const [strategy, setStrategy] = useState<Strategy>("zero_shot");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [cases, setCases] = useState("");
  const [limit, setLimit] = useState("");
  const [force, setForce] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [events, setEvents] = useState<string[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const body = useMemo(() => {
    const caseList = cases
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const parsedLimit = limit.trim() ? Number(limit) : undefined;
    return {
      strategy,
      model,
      force,
      dataset_filter:
        caseList.length > 0 || parsedLimit
          ? {
              cases: caseList.length > 0 ? caseList : undefined,
              limit: parsedLimit,
            }
          : undefined,
    };
  }, [cases, force, limit, model, strategy]);

  async function startRun() {
    setIsRunning(true);
    setStatus("Starting run...");
    setEvents([]);
    setRunId(null);

    try {
      const response = await fetch(`${SERVER_URL}/api/v1/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setStatus(`Failed to start: ${response.status}`);
        return;
      }
      const payload = (await response.json()) as { runId?: string };
      if (!payload.runId) {
        setStatus("Run started, but no run id was returned.");
        return;
      }
      setRunId(payload.runId);
      setStatus(`Running ${payload.runId}`);

      const source = new EventSource(`${SERVER_URL}/api/v1/runs/${payload.runId}/events`);
      source.addEventListener("case_scored", (event) => {
        const parsed = JSON.parse(event.data) as { transcriptId?: string; payload?: { macroScore?: number } };
        setEvents((current) => [
          `${parsed.transcriptId ?? "case"} scored ${parsed.payload?.macroScore?.toFixed(3) ?? ""}`,
          ...current,
        ].slice(0, 8));
        router.refresh();
      });
      source.addEventListener("case_failed", (event) => {
        const parsed = JSON.parse(event.data) as { transcriptId?: string };
        setEvents((current) => [`${parsed.transcriptId ?? "case"} failed`, ...current].slice(0, 8));
        router.refresh();
      });
      source.addEventListener("run_complete", () => {
        setStatus("Run complete");
        setIsRunning(false);
        source.close();
        router.refresh();
      });
      source.addEventListener("run_error", () => {
        setStatus("Run failed");
        setIsRunning(false);
        source.close();
        router.refresh();
      });
      source.onerror = () => {
        setStatus("Progress stream disconnected. Refreshing run list...");
        setIsRunning(false);
        source.close();
        router.refresh();
      };
    } catch {
      setStatus("Could not reach server on port 8787.");
      setIsRunning(false);
    }
  }

  return (
    <section className="grid gap-3 rounded-md border p-4">
      <div>
        <h2 className="font-medium">Start Run</h2>
        <p className="text-sm text-muted-foreground">
          Launches a server-side run and streams progress over SSE. Use a small case list for cheap smoke tests.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-[160px_1fr_160px_160px_auto]">
        <label className="grid gap-1 text-sm">
          Strategy
          <select className="h-9 rounded-md border bg-background px-2" value={strategy} onChange={(event) => setStrategy(event.target.value as Strategy)}>
            <option value="zero_shot">zero_shot</option>
            <option value="few_shot">few_shot</option>
            <option value="cot">cot</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Model
          <input className="h-9 rounded-md border bg-background px-2 font-mono text-xs" value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          Cases
          <input className="h-9 rounded-md border bg-background px-2 font-mono text-xs" placeholder="case_001,case_002" value={cases} onChange={(event) => setCases(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          Limit
          <input className="h-9 rounded-md border bg-background px-2" placeholder="50" value={limit} onChange={(event) => setLimit(event.target.value)} />
        </label>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
          Force
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
          disabled={isRunning}
          onClick={() => void startRun()}
        >
          {isRunning ? "Running..." : "Start"}
        </button>
        <span className="text-sm text-muted-foreground">{status}</span>
        {runId ? (
          <a className="text-sm underline" href={`/runs/${runId}`}>
            Open run
          </a>
        ) : null}
      </div>
      {events.length > 0 ? (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {events.map((event, index) => (
            <li key={`${event}-${index}`}>{event}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
