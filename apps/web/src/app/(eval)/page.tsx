import Link from "next/link";

import { getRun, getRuns } from "@/lib/api";
import { Card, Icon, ScoreBar, StatusTag, StrategyTag, fmt } from "@/components/primitives";

const FIELD_KEYS: Array<{ key: string; label: string }> = [
  { key: "chief_complaint", label: "chief complaint" },
  { key: "vitals", label: "vitals" },
  { key: "medications", label: "medications" },
  { key: "diagnoses", label: "diagnoses" },
  { key: "plan", label: "plan" },
  { key: "follow_up", label: "follow up" },
];

export default async function RunsPage() {
  const runs = await getRuns();
  const details = await Promise.all(runs.map((r) => getRun(r.id)));

  const totalRuns = runs.length;
  const totalCost = runs.reduce((s, r) => s + (r.totalCostUsd ?? 0), 0);
  const totalCases = details.reduce((sum, detail) => sum + (detail?.cases.length ?? 0), 0);
  const totalHallucinations = runs.reduce((s, r) => s + (r.hallucinationCount ?? 0), 0);
  const totalCacheRead = runs.reduce((s, r) => s + (r.cacheReadInputTokens ?? 0), 0);
  const bestMacro = runs.length ? Math.max(...runs.map((r) => r.macroFieldScore ?? 0)) : 0;
  const strategies = new Set(runs.map((r) => r.strategy));
  const leader = runs.find((r) => r.macroFieldScore === bestMacro);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Eval harness · clinical extraction</div>
          <h1 className="page-title">
            Runs <span className="muted">/ all strategies</span>
          </h1>
          <p className="page-sub">
            Every prompt-strategy run on the 50-case clinical extraction set. Compare any two for per-field deltas, drill
            into a run for case-level scores, transcript grounding, and the full LLM trace.
          </p>
        </div>
        <div className="page-actions">
          <Link href="/compare" className="btn">
            <Icon.compare /> Compare runs
          </Link>
          <Link href="/launch" className="btn primary">
            <Icon.play /> New run
          </Link>
        </div>
      </div>

      <div className="stat-strip" style={{ marginBottom: 24 }}>
        <div className="stat">
          <div className="stat-label">Runs</div>
          <div className="stat-value">{totalRuns}</div>
          <div className="stat-meta">across {strategies.size} strategies</div>
        </div>
        <div className="stat">
          <div className="stat-label">Best macro F1</div>
          <div className="stat-value">{totalRuns ? fmt.num(bestMacro) : "—"}</div>
          <div className="stat-meta">{leader ? `${leader.strategy} leads` : "no runs yet"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Cases evaluated</div>
          <div className="stat-value">{totalCases}</div>
          <div className="stat-meta">stored case results</div>
        </div>
        <div className="stat">
          <div className="stat-label">Hallucinations</div>
          <div className="stat-value">{totalHallucinations}</div>
          <div className="stat-meta">flagged across runs</div>
        </div>
        <div className="stat">
          <div className="stat-label">Cache read</div>
          <div className="stat-value">{(totalCacheRead / 1000).toFixed(0)}k</div>
          <div className="stat-meta">tokens · prompt cached</div>
        </div>
        <div className="stat">
          <div className="stat-label">Spend</div>
          <div className="stat-value">${totalCost.toFixed(2)}</div>
          <div className="stat-meta">all-time · Haiku 4.5</div>
        </div>
      </div>

      <Card flush>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Run</th>
                <th>Strategy</th>
                <th>Started</th>
                <th>Status</th>
                <th style={{ width: 200 }}>Macro F1</th>
                <th className="right">Hallu.</th>
                <th className="right">Cache</th>
                <th className="right">Cost</th>
                <th style={{ width: 24 }} />
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 32, textAlign: "center", color: "var(--ink-3)" }}>
                    No runs yet. Launch one from{" "}
                    <Link href="/launch" style={{ textDecoration: "underline" }}>
                      New run
                    </Link>
                    .
                  </td>
                </tr>
              ) : (
                runs.map((r) => {
                  const shortId = r.id.length > 12 ? r.id.slice(0, 12) : r.id;
                  return (
                    <tr
                      key={r.id}
                      className="row-link"
                      onClick={undefined}
                      style={{ cursor: "default" }}
                    >
                      <td>
                        <Link href={`/runs/${r.id}`} style={{ display: "block" }}>
                          <div style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{shortId}</div>
                          <div className="mono muted" style={{ fontSize: 10.5 }}>
                            {r.promptHash ? `${r.promptHash.slice(0, 10)}…` : ""}
                          </div>
                        </Link>
                      </td>
                      <td>
                        <StrategyTag s={r.strategy} />
                      </td>
                      <td className="mono muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                        {fmt.dateTime(r.createdAt)}
                      </td>
                      <td>
                        <StatusTag status={r.status} />
                      </td>
                      <td>
                        <ScoreBar value={r.macroFieldScore} />
                      </td>
                      <td className="num">{r.hallucinationCount}</td>
                      <td className="num">{((r.cacheReadInputTokens ?? 0) / 1000).toFixed(0)}k</td>
                      <td className="num">{fmt.usd(r.totalCostUsd)}</td>
                      <td className="right" style={{ color: "var(--ink-4)" }}>
                        <Link href={`/runs/${r.id}`} aria-label="open">
                          <Icon.chev />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {runs.length > 0 ? (
        <>
          <div className="divider" />
          <Card
            eyebrow="Quick read"
            title="Field-level standings, all strategies"
            right={
              <span className="mono muted">
                last run · {fmt.date(runs[0]?.createdAt)}
              </span>
            }
          >
            <div className="field-bars">
              {FIELD_KEYS.map(({ key, label }) => {
                const vals: { s: string; v: number }[] = [];
                for (const d of details) {
                  if (!d) continue;
                  const fields = d.aggregate?.fieldScores as Record<string, number> | undefined;
                  const v = fields?.[key];
                  if (v !== undefined && v !== null) vals.push({ s: d.strategy, v });
                }
                if (vals.length === 0) {
                  return (
                    <div key={key} className="fbar">
                      <div className="label">{label}</div>
                      <div className="val">—</div>
                      <div className="track">
                        <span className="fill" style={{ width: "0%" }} />
                      </div>
                      <div className="mono muted" style={{ fontSize: 10.5 }}>
                        no data yet
                      </div>
                    </div>
                  );
                }
                const winner = vals.reduce((a, b) => (b.v > a.v ? b : a));
                return (
                  <div key={key} className="fbar">
                    <div className="label">{label}</div>
                    <div className="val">{winner.v.toFixed(3)}</div>
                    <div className="track">
                      <span className="fill" style={{ width: `${winner.v * 100}%` }} />
                    </div>
                    <div className="mono muted" style={{ fontSize: 10.5 }}>
                      winner: <span style={{ color: "var(--ink-2)" }}>{winner.s}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
