"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CaseDetailDto, RunDetailDto } from "@test-evals/shared";

import { Card, JsonBlock, StrategyTag } from "@/components/primitives";

const FIELD_KEYS = ["chief_complaint", "vitals", "medications", "diagnoses", "plan", "follow_up"] as const;

type View = "diff" | "side" | "pred" | "gold";

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectStrings(obj: unknown, acc: string[] = []): string[] {
  if (obj === null || obj === undefined) return acc;
  if (typeof obj === "string") {
    if (obj.length > 2) acc.push(obj);
    return acc;
  }
  if (typeof obj === "number") {
    acc.push(String(obj));
    return acc;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v) => collectStrings(v, acc));
    return acc;
  }
  if (typeof obj === "object") {
    Object.values(obj as Record<string, unknown>).forEach((v) => collectStrings(v, acc));
    return acc;
  }
  return acc;
}

function highlightTranscript(text: string, terms: string[], badPaths: Set<string>, hallValues: Set<string>): string {
  let html = escapeHtml(text);
  html = html.replace(/^(Doctor|Patient):/gm, '<span class="speaker">$1:</span>');
  html = html.replace(/^(\[.*?\])$/gm, '<span class="meta">$1</span>');
  const seen = new Set<string>();
  const sorted = [...new Set(terms)]
    .filter(Boolean)
    .filter((t) => t.length >= 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, 40);
  for (const t of sorted) {
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    const safe = escapeRegex(t);
    const re = new RegExp(`(${safe})`, "gi");
    const isBad = hallValues.has(t);
    html = html.replace(re, isBad ? `<mark class="bad">$1</mark>` : `<mark>$1</mark>`);
    void badPaths;
  }
  return html;
}

export default function CaseDetailView({ run, detail }: { run: RunDetailDto; detail: CaseDetailDto }) {
  const [view, setView] = useState<View>("diff");
  const [openTrace, setOpenTrace] = useState<number>(0);

  const groundingTerms = useMemo(() => collectStrings(detail.prediction ?? {}), [detail.prediction]);
  const hallValues = useMemo(() => new Set(detail.hallucinations.map((h) => h.value)), [detail.hallucinations]);
  const hallPaths = useMemo(() => new Set(detail.hallucinations.map((h) => h.path)), [detail.hallucinations]);
  const transcriptHtml = useMemo(
    () => highlightTranscript(detail.transcript ?? "", groundingTerms, hallPaths, hallValues),
    [detail.transcript, groundingTerms, hallPaths, hallValues],
  );

  const fields = (detail.fieldScores ?? null) as Record<string, { score: number }> | null;

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">
            {run.id.slice(0, 12)} · <StrategyTag s={run.strategy} />
          </div>
          <h1 className="page-title">
            {detail.transcriptId} <span className="muted">/ {detail.gold.diagnoses?.[0]?.description ?? "case"}</span>
          </h1>
          <p className="page-sub mono" style={{ fontSize: 12 }}>
            case score <span style={{ color: "var(--ink-2)" }}>{detail.macroScore?.toFixed(3) ?? "—"}</span> ·{" "}
            {detail.hallucinationCount} hallucination flag{detail.hallucinationCount === 1 ? "" : "s"} · {detail.attempts.length} attempt{detail.attempts.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="page-actions">
          <Link href={`/runs/${run.id}`} className="btn">
            ← Back to run
          </Link>
        </div>
      </div>

      <div className="stat-strip" style={{ marginBottom: 22 }}>
        {FIELD_KEYS.map((k) => {
          const v = fields?.[k]?.score;
          return (
            <div className="stat" key={k}>
              <div className="stat-label">{k.replace(/_/g, " ")}</div>
              <div
                className="stat-value"
                style={{
                  color: v === undefined ? "var(--ink-4)" : v >= 0.85 ? "var(--good)" : v < 0.5 ? "var(--bad)" : "var(--ink)",
                }}
              >
                {v === undefined ? "—" : v.toFixed(2)}
              </div>
              <div className="stat-meta">{v === undefined ? "—" : v >= 0.85 ? "match" : v >= 0.6 ? "partial" : "miss"}</div>
            </div>
          );
        })}
      </div>

      <div className="case-grid">
        <Card
          title="Transcript"
          right={
            <span className="mono muted">
              <span style={{ color: "var(--teal)" }}>■</span> grounded &nbsp;
              <span style={{ color: "var(--bad)" }}>■</span> not in transcript
            </span>
          }
        >
          <div className="transcript" dangerouslySetInnerHTML={{ __html: transcriptHtml }} />
        </Card>

        <div style={{ display: "grid", gap: 16 }}>
          <Card
            title="Extraction"
            right={
              <div className="seg">
                <button className={view === "diff" ? "on" : ""} onClick={() => setView("diff")}>
                  Diff
                </button>
                <button className={view === "side" ? "on" : ""} onClick={() => setView("side")}>
                  Side-by-side
                </button>
                <button className={view === "pred" ? "on" : ""} onClick={() => setView("pred")}>
                  Predicted
                </button>
                <button className={view === "gold" ? "on" : ""} onClick={() => setView("gold")}>
                  Gold
                </button>
              </div>
            }
            flush
          >
            {view === "diff" ? <DiffView gold={detail.gold} pred={detail.prediction} /> : null}
            {view === "side" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                <div style={{ borderRight: "1px solid var(--rule)" }}>
                  <div
                    className="mono muted"
                    style={{
                      fontSize: 10.5,
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--rule)",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Gold
                  </div>
                  <div style={{ padding: 14 }}>
                    <JsonBlock data={detail.gold} />
                  </div>
                </div>
                <div>
                  <div
                    className="mono muted"
                    style={{
                      fontSize: 10.5,
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--rule)",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Predicted
                  </div>
                  <div style={{ padding: 14 }}>
                    <JsonBlock data={detail.prediction ?? {}} />
                  </div>
                </div>
              </div>
            ) : null}
            {view === "pred" ? (
              <div style={{ padding: 14 }}>
                <JsonBlock data={detail.prediction ?? {}} />
              </div>
            ) : null}
            {view === "gold" ? (
              <div style={{ padding: 14 }}>
                <JsonBlock data={detail.gold} />
              </div>
            ) : null}
          </Card>

          {detail.hallucinations.length > 0 ? (
            <Card title="Hallucination flags" right={<span className="mono muted">predicted values not grounded in transcript</span>}>
              <ul className="err-list">
                {detail.hallucinations.map((h, i) => (
                  <li key={`${h.path}-${i}`} style={{ color: "var(--bad)" }}>
                    <span style={{ fontWeight: 500 }}>{h.path}</span> = {JSON.stringify(h.value)} — {h.reason}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card
            title="LLM trace"
            right={<span className="mono muted">{detail.attempts.length} attempt{detail.attempts.length === 1 ? "" : "s"} · cap 3</span>}
            flush
          >
            <div className="trace">
              {detail.attempts.length === 0 ? (
                <div style={{ padding: 16, color: "var(--ink-3)" }} className="muted">
                  No attempts captured.
                </div>
              ) : (
                detail.attempts.map((t, i) => (
                  <div key={`${t.attempt}-${i}`} className="trace-step">
                    <div className="trace-head" onClick={() => setOpenTrace(openTrace === i ? -1 : i)}>
                      <div className="trace-attempt">attempt {t.attempt}</div>
                      <div className="trace-title">
                        {t.status === "valid" ? (
                          <span className="tag ok">tool call valid</span>
                        ) : t.status === "invalid" ? (
                          <span className="tag bad">schema validation failed</span>
                        ) : (
                          <span className="tag bad">{t.errorMessage ?? "error"}</span>
                        )}
                      </div>
                      <div className="trace-meta">
                        <span>{t.latencyMs}ms</span>
                        <span>in {t.usage.inputTokens}</span>
                        <span>out {t.usage.outputTokens}</span>
                        <span>cache_read {t.usage.cacheReadInputTokens.toLocaleString()}</span>
                      </div>
                    </div>
                    {openTrace === i ? (
                      <div className="trace-body">
                        <div className="trace-block">
                          <div className="label">Request</div>
                          <code>{t.requestSummary}</code>
                        </div>
                        {t.scratchpad ? (
                          <div className="trace-block">
                            <div className="label">Scratchpad</div>
                            <code>{t.scratchpad}</code>
                          </div>
                        ) : null}
                        {t.toolInput ? (
                          <div className="trace-block">
                            <div className="label">Tool input</div>
                            <JsonBlock data={t.toolInput} style={{ background: "transparent", border: "none", padding: 0 }} />
                          </div>
                        ) : null}
                        {t.validationErrors.length > 0 ? (
                          <div className="trace-block" style={{ background: "var(--bad-tint)", borderColor: "rgba(180,35,24,0.25)" }}>
                            <div className="label" style={{ color: "var(--bad)" }}>
                              Validation errors → fed back to model
                            </div>
                            <ul className="err-list">
                              {t.validationErrors.map((e, k) => (
                                <li key={k}>{e}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DiffView({
  gold,
  pred,
}: {
  gold: CaseDetailDto["gold"];
  pred: CaseDetailDto["prediction"];
}) {
  const goldRec = gold as unknown as Record<string, unknown>;
  const predRec = (pred ?? {}) as unknown as Record<string, unknown>;
  return (
    <div style={{ padding: "8px 0" }}>
      {FIELD_KEYS.map((f) => {
        const g = goldRec[f];
        const p = predRec[f];
        const equal = JSON.stringify(g) === JSON.stringify(p);
        return (
          <div key={f} style={{ borderBottom: "1px solid var(--rule)", padding: "10px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{f.replace(/_/g, " ")}</span>
              {equal ? <span className="tag ok">match</span> : <span className="tag warn">diff</span>}
            </div>
            {!equal ? (
              <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.6 }}>
                <div className="diff-line del">{JSON.stringify(g)}</div>
                <div className="diff-line add">{JSON.stringify(p)}</div>
              </div>
            ) : (
              <div className="mono muted" style={{ fontSize: 11.5 }}>
                {JSON.stringify(g).slice(0, 120)}
                {JSON.stringify(g).length > 120 ? "…" : ""}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
