"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { RunListItem } from "@test-evals/shared";

import { Card, Icon, fmt } from "@/components/primitives";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

type Strategy = "zero_shot" | "few_shot" | "cot";
type Phase = "config" | "running" | "done" | "error";

interface LiveEvent {
  cid: string;
  score: number | null;
  ok: boolean;
  t: Date;
}

export default function LauncherView({ runs }: { runs: RunListItem[] }) {
  const router = useRouter();

  const [strategy, setStrategy] = useState<Strategy>("zero_shot");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState("");
  const [force, setForce] = useState(false);

  const [phase, setPhase] = useState<Phase>("config");
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState(0);
  const [retries, setRetries] = useState(0);
  const [log, setLog] = useState<LiveEvent[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>("Idle");
  const [costSoFar, setCostSoFar] = useState(0);

  useEffect(() => {
    return () => {
      // cleanup will be handled by the source.close() inside startRun
    };
  }, []);

  const lastRunForStrategy = useMemo(
    () => runs.find((r) => r.strategy === strategy) ?? null,
    [runs, strategy],
  );

  const targetCases = useMemo(() => {
    const caseCount = filter
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean).length;
    if (caseCount > 0) return caseCount;
    const parsedLimit = limit.trim() ? Number(limit) : 50;
    return Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
  }, [filter, limit]);

  const projectedCost = useMemo(() => {
    return targetCases * 0.0033 * (strategy === "cot" ? 2.5 : 1);
  }, [strategy, targetCases]);

  function buildBody() {
    const caseList = filter
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
  }

  async function startRun() {
    setPhase("running");
    setStatusMsg("Starting run…");
    setProgress(0);
    setErrors(0);
    setRetries(0);
    setLog([]);
    setRunId(null);
    setCostSoFar(0);

    try {
      const response = await fetch(`${SERVER_URL}/api/v1/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      if (!response.ok) {
        setPhase("error");
        setStatusMsg(`Failed to start: HTTP ${response.status}`);
        return;
      }
      const payload = (await response.json()) as { runId?: string };
      if (!payload.runId) {
        setPhase("error");
        setStatusMsg("Run started, but no run id was returned.");
        return;
      }
      setRunId(payload.runId);
      setStatusMsg(`Running ${payload.runId.slice(0, 12)}…`);

      const source = new EventSource(`${SERVER_URL}/api/v1/runs/${payload.runId}/events`);

      source.addEventListener("case_scored", (event) => {
        const parsed = JSON.parse((event as MessageEvent).data) as {
          transcriptId?: string;
          payload?: { macroScore?: number; costUsd?: number };
        };
        const score = parsed.payload?.macroScore ?? null;
        const cost = parsed.payload?.costUsd ?? 0;
        setProgress((p) => p + 1);
        setCostSoFar((c) => c + cost);
        setLog((prev) =>
          [{ cid: parsed.transcriptId ?? "case", score, ok: true, t: new Date() }, ...prev].slice(0, 14),
        );
      });

      source.addEventListener("case_failed", (event) => {
        const parsed = JSON.parse((event as MessageEvent).data) as { transcriptId?: string };
        setProgress((p) => p + 1);
        setErrors((e) => e + 1);
        setLog((prev) => [{ cid: parsed.transcriptId ?? "case", score: null, ok: false, t: new Date() }, ...prev].slice(0, 14));
      });

      source.addEventListener("case_attempt", () => {
        setRetries((r) => r + 1);
      });

      source.addEventListener("run_complete", () => {
        setPhase("done");
        setStatusMsg("Run complete");
        source.close();
        router.refresh();
      });

      source.addEventListener("run_error", () => {
        setPhase("error");
        setStatusMsg("Run failed on server");
        source.close();
        router.refresh();
      });

      source.onerror = () => {
        setStatusMsg("Progress stream disconnected — refreshing run list");
        source.close();
        setPhase((p) => (p === "running" ? "done" : p));
        router.refresh();
      };
    } catch {
      setPhase("error");
      setStatusMsg("Could not reach server on port 8787.");
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">New evaluation run</div>
          <h1 className="page-title">Launch a run</h1>
          <p className="page-sub">
            Configure the prompt strategy, model, and dataset filter. The runner is resumable and idempotent — re-running
            with the same settings replays from cache unless you force.
          </p>
        </div>
      </div>

      {phase === "config" || phase === "error" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24 }}>
          <Card title="Configuration" flush>
            <div className="card-body">
              <div className="form-grid">
                <label className="form-label">
                  Strategy <span className="help">swappable prompt module</span>
                </label>
                <div className="seg">
                  {(["zero_shot", "few_shot", "cot"] as const).map((s) => (
                    <button key={s} className={strategy === s ? "on" : ""} onClick={() => setStrategy(s)}>
                      {s}
                    </button>
                  ))}
                </div>

                <label className="form-label">
                  Model <span className="help">budget capped at $1 / 50 cases</span>
                </label>
                <input className="input" value={model} onChange={(e) => setModel(e.target.value)} />

                <label className="form-label">
                  Cases <span className="help">comma-separated transcript ids, leave blank for all</span>
                </label>
                <input
                  className="input"
                  placeholder="case_001, case_002"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />

                <label className="form-label">
                  Limit <span className="help">cap how many cases to run</span>
                </label>
                <input
                  className="input"
                  placeholder="50"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  inputMode="numeric"
                />

                <label className="form-label">
                  Concurrency <span className="help">fixed by runner</span>
                </label>
                <div className="mono muted" style={{ fontSize: 11 }}>
                  up to 5 cases in-flight · 429 retry-after + jittered backoff
                </div>

                <label className="form-label">
                  Force <span className="help">bypass idempotency cache</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> re-call LLM even
                  if (strategy, model, transcript) is cached
                </label>
              </div>
            </div>
            <div
              style={{
                padding: 16,
                borderTop: "1px solid var(--rule)",
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <button className="btn" onClick={() => router.push("/")}>
                Cancel
              </button>
              {phase === "error" ? (
                <span className="mono" style={{ color: "var(--bad)", fontSize: 11 }}>
                  {statusMsg}
                </span>
              ) : null}
              <div style={{ marginLeft: "auto" }} className="mono muted">
                projected cost{" "}
                <span style={{ color: "var(--ink-2)" }}>${projectedCost.toFixed(3)}</span>
              </div>
              <button className="btn primary" onClick={startRun}>
                <Icon.play /> Launch run
              </button>
            </div>
          </Card>

          <div style={{ display: "grid", gap: 16 }}>
            <Card title="Strategy notes">
              <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
                {strategy === "zero_shot" ? (
                  <>
                    <p style={{ marginTop: 0 }}>
                      Schema and tool-call instructions only. Cheapest baseline; usually leads on macro F1. Best at
                      medications and plan extraction.
                    </p>
                    <p>Weak at chief-complaint phrasing and ICD-10 codes.</p>
                  </>
                ) : strategy === "few_shot" ? (
                  <>
                    <p style={{ marginTop: 0 }}>
                      Cached normalization reference plus a few worked examples (drawn from outside the eval set). Wins
                      diagnoses and vitals; loses medications.
                    </p>
                    <p>Higher cache-read token use; worth it if vitals quality matters.</p>
                  </>
                ) : (
                  <>
                    <p style={{ marginTop: 0 }}>
                      Two-stage: scratchpad call followed by tool call. Only the tool payload is evaluated.
                    </p>
                    <p>
                      Most expensive (×2.5) and currently losing on aggregate. Lower cache-read ratio is expected — the
                      second call has per-case scratchpad text.
                    </p>
                  </>
                )}
              </div>
            </Card>
            {lastRunForStrategy ? (
              <Card title={`Last run · ${strategy}`}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                  }}
                >
                  <KV k="macro F1" v={fmt.num(lastRunForStrategy.macroFieldScore)} />
                  <KV k="cost" v={`$${lastRunForStrategy.totalCostUsd.toFixed(3)}`} />
                  <KV k="hallucinations" v={String(lastRunForStrategy.hallucinationCount)} />
                  <KV k="cache read" v={`${((lastRunForStrategy.cacheReadInputTokens ?? 0) / 1000).toFixed(0)}k`} />
                  <KV
                    k="prompt hash"
                    v={lastRunForStrategy.promptHash ? `${lastRunForStrategy.promptHash.slice(0, 10)}…` : "—"}
                  />
                  <KV k="status" v={lastRunForStrategy.status} />
                </div>
              </Card>
            ) : (
              <Card title={`Last run · ${strategy}`}>
                <div className="mono muted" style={{ fontSize: 12 }}>
                  No prior run for this strategy yet.
                </div>
              </Card>
            )}
          </div>
        </div>
      ) : null}

      {phase === "running" || (phase === "done" && runId) ? (
        <Card
          title={phase === "running" ? "Run in progress" : "Run complete"}
          eyebrow={phase === "running" ? <span className="pulse-dot" /> : undefined}
          right={
            <span className="mono muted">
              {progress} / {targetCases} cases · {phase === "done" ? "complete" : "live progress"}
            </span>
          }
        >
          <div className="live-bar">
            <div className="lf" style={{ width: `${Math.min(100, (progress / targetCases) * 100)}%` }} />
          </div>
          <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <div>
              <div
                className="mono muted"
                style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}
              >
                Recent completions
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.7 }}>
                {log.length === 0 ? (
                  <div className="muted">waiting…</div>
                ) : (
                  log.map((l, i) => (
                    <div key={`${l.cid}-${i}`} style={{ display: "flex", gap: 12, color: "var(--ink-2)" }}>
                      <span className="muted">{l.t.toLocaleTimeString().split(" ")[0]}</span>
                      <span>{l.cid}</span>
                      <span
                        style={{
                          color: !l.ok
                            ? "var(--bad)"
                            : l.score !== null && l.score < 0.6
                              ? "var(--bad)"
                              : l.score !== null && l.score >= 0.85
                                ? "var(--good)"
                                : "var(--ink-2)",
                        }}
                      >
                        {l.ok ? `score ${l.score?.toFixed(3) ?? "—"}` : "failed"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div>
              <div
                className="mono muted"
                style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}
              >
                Live counters
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                }}
              >
                <KV k="completed" v={String(progress)} />
                <KV k="target" v={String(targetCases)} />
                <KV k="errors" v={String(errors)} />
                <KV k="retries" v={String(retries)} />
                <KV k="cost so far" v={`$${costSoFar.toFixed(3)}`} />
                <KV k="run id" v={runId ? `${runId.slice(0, 12)}…` : "—"} />
                <KV k="status" v={statusMsg} />
              </div>
            </div>
          </div>
          <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
            {runId ? (
              <a className="btn" href={`/runs/${runId}`}>
                Open run
              </a>
            ) : null}
            <button className="btn" onClick={() => router.push("/")}>
              Back to runs
            </button>
            <div style={{ marginLeft: "auto" }} className="mono muted">
              {phase === "running" ? "resumable from last persisted case" : "all done"}
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        borderBottom: "1px dashed var(--rule)",
        paddingBottom: 4,
      }}
    >
      <span className="muted">{k}</span>
      <span style={{ color: "var(--ink-2)" }}>{v}</span>
    </div>
  );
}
