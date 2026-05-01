"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { RunDetailDto } from "@test-evals/shared";

import { Card, Icon, ScoreBar, StatusTag, StrategyTag, fmt } from "@/components/primitives";

const FIELD_KEYS = ["chief_complaint", "vitals", "medications", "diagnoses", "plan", "follow_up"] as const;

type Tab = "cases" | "failures" | "trace" | "prompt";
type SortKey = "case_id" | "score" | (typeof FIELD_KEYS)[number];

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}

export default function RunDetailView({ run }: { run: RunDetailDto }) {
  const [tab, setTab] = useState<Tab>("cases");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "case_id", dir: "asc" });

  const filtered = useMemo(() => {
    const src = run.cases.filter((c) => c.transcriptId.toLowerCase().includes(q.toLowerCase()));
    const dir = sort.dir === "asc" ? 1 : -1;
    src.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sort.key === "case_id") {
        av = a.transcriptId;
        bv = b.transcriptId;
      } else if (sort.key === "score") {
        av = a.macroScore ?? -1;
        bv = b.macroScore ?? -1;
      } else {
        av = a.fieldScores?.[sort.key]?.score ?? -1;
        bv = b.fieldScores?.[sort.key]?.score ?? -1;
      }
      return av > bv ? dir : av < bv ? -dir : 0;
    });
    return src;
  }, [run, q, sort]);

  const flagged = run.cases.filter((c) => c.hallucinationCount > 0).length;
  const lowCases = run.cases.filter((c) => (c.macroScore ?? 0) < 0.6).length;
  const worst = [...run.cases]
    .filter((c) => c.macroScore !== null && c.macroScore !== undefined)
    .sort((a, b) => (a.macroScore ?? 0) - (b.macroScore ?? 0))
    .slice(0, 5);

  const fieldScores = (run.aggregate?.fieldScores ?? {}) as Record<string, number>;
  const shortId = run.id.length > 12 ? run.id.slice(0, 12) : run.id;

  function setSortKey(k: SortKey) {
    setSort((p) => ({ key: k, dir: p.key === k && p.dir === "asc" ? "desc" : "asc" }));
  }

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Run · {shortId}</div>
          <h1 className="page-title">
            <StrategyTag s={run.strategy} /> &nbsp;
            <span className="muted" style={{ fontSize: 22 }}>on {run.model}</span>
          </h1>
          <p className="page-sub mono" style={{ fontSize: 12 }}>
            prompt hash{" "}
            <span style={{ color: "var(--ink-2)" }}>{run.promptHash ? `${run.promptHash.slice(0, 24)}…` : "—"}</span> ·{" "}
            {fmt.dateTime(run.createdAt)} · {run.completedAt ? `finished in ${formatDuration(run.durationMs)}` : "in flight"}
          </p>
        </div>
        <div className="page-actions">
          <Link href="/" className="btn">
            ← Runs
          </Link>
          <Link href={`/compare?left=${run.id}`} className="btn primary">
            Compare against…
          </Link>
        </div>
      </div>

      <div className="stat-strip" style={{ marginBottom: 22 }}>
        <div className="stat">
          <div className="stat-label">Macro F1</div>
          <div className="stat-value">{fmt.num(run.macroFieldScore)}</div>
          <div className="stat-meta">
            {run.aggregate?.averageCaseScore !== undefined ? `case avg ${run.aggregate.averageCaseScore.toFixed(3)}` : ""}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Schema fail</div>
          <div className="stat-value">{fmt.pct(run.schemaFailureRate)}</div>
          <div className="stat-meta">retry-loop caught all</div>
        </div>
        <div className="stat">
          <div className="stat-label">Hallucinations</div>
          <div className="stat-value">{run.hallucinationCount}</div>
          <div className="stat-meta">{flagged} cases flagged</div>
        </div>
        <div className="stat">
          <div className="stat-label">Cache read</div>
          <div className="stat-value">{((run.cacheReadInputTokens ?? 0) / 1000).toFixed(0)}k</div>
          <div className="stat-meta">{(run.cacheReadRatio * 100).toFixed(1)}% hit ratio</div>
        </div>
        <div className="stat">
          <div className="stat-label">Output tokens</div>
          <div className="stat-value">{((run.aggregate?.usage?.outputTokens ?? 0) / 1000).toFixed(1)}k</div>
          <div className="stat-meta">{formatDuration(run.durationMs)} wall</div>
        </div>
        <div className="stat">
          <div className="stat-label">Cost</div>
          <div className="stat-value">${run.totalCostUsd.toFixed(3)}</div>
          <div className="stat-meta">
            {run.cases.length > 0 ? `$${(run.totalCostUsd / run.cases.length).toFixed(4)} / case` : "—"}
          </div>
        </div>
      </div>

      <Card title="Where this run wins and loses" eyebrow="Per-field score" style={{ marginBottom: 22 }}>
        <div className="field-bars">
          {FIELD_KEYS.map((k) => {
            const v = fieldScores[k];
            return (
              <div key={k} className="fbar">
                <div className="label">{k.replace(/_/g, " ")}</div>
                <div className="val">{v === undefined ? "—" : v.toFixed(3)}</div>
                <div className="track">
                  <span
                    className="fill"
                    style={{
                      width: `${(v ?? 0) * 100}%`,
                      background: v === undefined ? "var(--ink-5)" : v >= 0.8 ? "var(--good)" : v >= 0.6 ? "var(--ink)" : "var(--bad)",
                    }}
                  />
                </div>
                <div className="mono muted" style={{ fontSize: 10.5 }}>
                  {v === undefined ? "—" : v >= 0.8 ? "strong" : v >= 0.6 ? "mixed" : "weak — investigate"}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="tabs">
        <button className={tab === "cases" ? "on" : ""} onClick={() => setTab("cases")}>
          Cases <span className="count">{run.cases.length}</span>
        </button>
        <button className={tab === "failures" ? "on" : ""} onClick={() => setTab("failures")}>
          Flagged cases <span className="count">{flagged}</span>
        </button>
        <button className={tab === "trace" ? "on" : ""} onClick={() => setTab("trace")}>
          Run notes
        </button>
        <button className={tab === "prompt" ? "on" : ""} onClick={() => setTab("prompt")}>
          Prompt
        </button>
      </div>

      {tab === "cases" && (
        <>
          <div className="row-flex" style={{ marginBottom: 12 }}>
            <div className="search">
              <Icon.search />
              <input placeholder="Filter by case id…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="mono muted" style={{ marginLeft: "auto" }}>
              {filtered.length} cases · {lowCases} below 0.6 · {flagged} flagged
            </div>
          </div>

          <Card flush>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th onClick={() => setSortKey("case_id")} style={{ cursor: "pointer" }}>
                      Case
                    </th>
                    <th onClick={() => setSortKey("score")} style={{ cursor: "pointer", width: 200 }}>
                      Score
                    </th>
                    {FIELD_KEYS.map((f) => (
                      <th key={f} className="right" onClick={() => setSortKey(f)} style={{ cursor: "pointer" }}>
                        {f === "chief_complaint" ? "Chief" : f === "medications" ? "Meds" : f === "diagnoses" ? "Dx" : f === "follow_up" ? "F/U" : f}
                      </th>
                    ))}
                    <th className="right">Flags</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="row-link">
                      <td className="mono" style={{ fontSize: 12 }}>
                        <Link href={`/runs/${run.id}/cases/${c.transcriptId}`} style={{ display: "block" }}>
                          {c.transcriptId}
                        </Link>
                      </td>
                      <td>
                        <ScoreBar value={c.macroScore} />
                      </td>
                      {FIELD_KEYS.map((f) => {
                        const fv = c.fieldScores?.[f]?.score;
                        return (
                          <td
                            key={f}
                            className="num"
                            style={{
                              color:
                                fv === undefined || fv === null
                                  ? "var(--ink-4)"
                                  : fv < 0.5
                                    ? "var(--bad)"
                                    : fv >= 0.85
                                      ? "var(--good)"
                                      : "var(--ink-2)",
                            }}
                          >
                            {fv === undefined || fv === null ? "—" : fv.toFixed(2)}
                          </td>
                        );
                      })}
                      <td className="right">
                        {c.hallucinationCount > 0 ? (
                          <span className="tag bad">{c.hallucinationCount} hallu</span>
                        ) : c.status !== "done" ? (
                          <StatusTag status={c.status} />
                        ) : (
                          <span className="muted mono" style={{ fontSize: 11 }}>
                            —
                          </span>
                        )}
                      </td>
                      <td className="right" style={{ color: "var(--ink-4)" }}>
                        <Link href={`/runs/${run.id}/cases/${c.transcriptId}`} aria-label="open">
                          <Icon.chev />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "failures" && (
        <Card title="Worst 5 cases" right={<span className="mono muted">candidates for prompt-iteration focus</span>}>
          <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {worst.length === 0 ? (
              <li className="muted">No scored cases yet.</li>
            ) : (
              worst.map((c, i) => (
                <li
                  key={c.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "32px 140px 1fr 220px 80px",
                    gap: 14,
                    alignItems: "center",
                    padding: "10px 0",
                    borderBottom: i < worst.length - 1 ? "1px solid var(--rule)" : "none",
                  }}
                >
                  <div className="mono muted">#{i + 1}</div>
                  <Link href={`/runs/${run.id}/cases/${c.transcriptId}`} className="mono" style={{ fontSize: 12 }}>
                    {c.transcriptId}
                  </Link>
                  <div style={{ color: "var(--ink-3)", fontSize: 12.5 }}>
                    {c.errorMessage ?? "low macro score — open the case to inspect transcript grounding and per-field deltas"}
                  </div>
                  <ScoreBar value={c.macroScore} />
                  <div className="right">
                    {c.hallucinationCount > 0 && <span className="tag bad">{c.hallucinationCount} flags</span>}
                  </div>
                </li>
              ))
            )}
          </ol>
        </Card>
      )}

      {tab === "trace" && (
        <Card
          title="Run execution notes"
          right={<span className="mono muted">cap 5 in-flight · retry-after + jittered backoff</span>}
        >
          <div style={{ display: "grid", gap: 12, color: "var(--ink-2)", fontSize: 13, lineHeight: 1.6 }}>
            <p style={{ margin: 0 }}>
              The runner persists every case through pending → extracting → extracted → scored → done. Resume starts from
              the latest persisted state, so extracted cases can be scored without a second LLM call.
            </p>
            <p style={{ margin: 0 }}>
              Full request/response traces, validation errors, tool inputs, scratchpads, and cache statistics are captured
              per case. Open any case row to inspect the exact LLM attempts.
            </p>
            <div className="mono muted" style={{ fontSize: 11 }}>
              completed {run.cases.filter((c) => c.status === "done").length}/{run.cases.length} · wall{" "}
              {formatDuration(run.durationMs)} · cost ${run.totalCostUsd.toFixed(4)}
            </div>
          </div>
        </Card>
      )}

      {tab === "prompt" && (
        <Card title={`Prompt · ${run.strategy}`} right={<span className="mono muted">hash {run.promptHash?.slice(0, 16)}…</span>}>
          <pre className="json-block" style={{ whiteSpace: "pre-wrap" }}>
            {`Strategy: ${run.strategy}
Model: ${run.model}
Prompt hash: ${run.promptHash}

The prompt strategies and cacheable prefix are defined in packages/llm/src/prompts.ts. Changing the strategy name, system prompt, few-shot block, lexicon, or tool schema changes this hash.`}
          </pre>
        </Card>
      )}
    </div>
  );
}
