"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { CompareRunDto, RunDetailDto, RunListItem } from "@test-evals/shared";

import { Card, StrategyTag, fmt } from "@/components/primitives";

const STRATEGY_COLOR: Record<string, string> = {
  zero_shot: "#0E7C7B",
  few_shot: "#7A5AF8",
  cot: "#C2410C",
};

const FIELD_HELP: Record<string, string> = {
  vitals: "exact + numeric tolerance",
  medications: "set-F1, fuzzy name + normalized dose/freq",
  diagnoses: "set-F1 on description + ICD bonus",
  plan: "set-F1 on plan items",
  follow_up: "exact interval + fuzzy reason",
  chief_complaint: "fuzzy token-set",
};

export default function CompareView({
  runs,
  compare,
  leftDetail,
  rightDetail,
  defaultLeft,
  defaultRight,
}: {
  runs: RunListItem[];
  compare: CompareRunDto | null;
  leftDetail: RunDetailDto | null;
  rightDetail: RunDetailDto | null;
  defaultLeft: string | null;
  defaultRight: string | null;
}) {
  const router = useRouter();

  const datasetOverlap = useMemo(() => {
    if (!leftDetail || !rightDetail) {
      return { ids: [] as string[], onlyLeft: 0, onlyRight: 0, mismatch: false };
    }
    const aIds = new Set(leftDetail.cases.map((c) => c.transcriptId));
    const bIds = new Set(rightDetail.cases.map((c) => c.transcriptId));
    const ids = [...aIds].filter((id) => bIds.has(id)).sort();
    return {
      ids,
      onlyLeft: aIds.size - ids.length,
      onlyRight: bIds.size - ids.length,
      mismatch: aIds.size !== bIds.size || ids.length !== aIds.size || ids.length !== bIds.size,
    };
  }, [leftDetail, rightDetail]);

  const caseRows = useMemo(() => {
    if (!leftDetail || !rightDetail) return [];
    const aMap = new Map(leftDetail.cases.map((c) => [c.transcriptId, c.macroScore ?? 0]));
    const bMap = new Map(rightDetail.cases.map((c) => [c.transcriptId, c.macroScore ?? 0]));
    const rows = datasetOverlap.ids.map((cid) => {
      const av = aMap.get(cid) ?? 0;
      const bv = bMap.get(cid) ?? 0;
      const d = av - bv;
      const w: "a" | "b" | "tie" = Math.abs(d) < 0.03 ? "tie" : d > 0 ? "a" : "b";
      return { cid, av, bv, d, w };
    });
    rows.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    return rows;
  }, [leftDetail, rightDetail, datasetOverlap.ids]);

  const caseWins = useMemo(() => {
    let aw = 0;
    let bw = 0;
    let tie = 0;
    for (const r of caseRows) {
      if (r.w === "a") aw++;
      else if (r.w === "b") bw++;
      else tie++;
    }
    return { aw, bw, tie };
  }, [caseRows]);

  function setLeft(id: string) {
    router.push(`/compare?left=${id}&right=${defaultRight ?? ""}`);
  }

  function setRight(id: string) {
    router.push(`/compare?left=${defaultLeft ?? ""}&right=${id}`);
  }

  if (!compare || !leftDetail || !rightDetail) {
    return (
      <div className="page wide">
        <div className="page-head">
          <div>
            <div className="page-eyebrow">Compare · prompt strategy A/B</div>
            <h1 className="page-title">Run at least two evals to compare.</h1>
            <p className="page-sub">
              Once you have two completed runs, this page shows per-field score deltas with a winner threshold of{" "}
              <span className="mono">0.03</span>.
            </p>
          </div>
        </div>
        <div className="hob-card">
          <div className="card-body" style={{ color: "var(--ink-3)" }}>
            {runs.length < 2 ? (
              <>
                Currently have {runs.length} run{runs.length === 1 ? "" : "s"}.{" "}
                <Link href="/launch" style={{ textDecoration: "underline" }}>
                  Launch another
                </Link>{" "}
                to enable comparison.
              </>
            ) : (
              "Server is unreachable, or one of the selected runs is missing data."
            )}
          </div>
        </div>
      </div>
    );
  }

  const a = leftDetail;
  const b = rightDetail;
  const macroDelta = (a.macroFieldScore ?? 0) - (b.macroFieldScore ?? 0);

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Compare · prompt strategy A/B</div>
          <h1 className="page-title">Which prompt should we ship?</h1>
          <p className="page-sub">
            Per-field score deltas with a winner threshold of <span className="mono">0.03</span>. Anything inside that
            band is a tie — small aggregate movement masquerading as a decisive win is the most expensive mistake in eval
            work.
          </p>
        </div>
      </div>

      <div className="compare-pickers" style={{ marginBottom: 22 }}>
        <RunPicker label="Run A" runs={runs} value={a.id} onChange={setLeft} run={a} />
        <div className="compare-vs">vs</div>
        <RunPicker label="Run B" runs={runs} value={b.id} onChange={setRight} run={b} />
      </div>

      <Card
        eyebrow="Headline"
        title={
          datasetOverlap.mismatch ? (
            <span>
              <span className="tag warn">dataset mismatch</span> comparing {a.cases.length} vs {b.cases.length} cases —
              use matching case sets for a ship/no-ship decision.
            </span>
          ) : 
          Math.abs(macroDelta) < 0.03 ? (
            <span>
              Aggregate is a <span className="tag plain">tie</span> at Δ {macroDelta.toFixed(3)} — look at the field
              breakdown below.
            </span>
          ) : (
            <span>
              <StrategyTag s={(macroDelta > 0 ? a : b).strategy} /> wins overall by {Math.abs(macroDelta).toFixed(3)} macro F1.
            </span>
          )
        }
        style={{ marginBottom: 22 }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
          <HeadlineStat
            label="Run macro Δ"
            big={macroDelta.toFixed(3)}
            sub={datasetOverlap.mismatch ? "full-run aggregates; datasets differ" : `${a.strategy} − ${b.strategy}`}
            tier={datasetOverlap.mismatch || Math.abs(macroDelta) < 0.03 ? "neutral" : macroDelta > 0 ? "good" : "bad"}
          />
          <HeadlineStat
            label="Shared case wins"
            big={`${caseWins.aw} / ${caseWins.bw}`}
            sub={`${caseWins.tie} ties · ${caseRows.length} shared cases`}
            tier={caseWins.aw > caseWins.bw ? "good" : caseWins.aw < caseWins.bw ? "bad" : "neutral"}
          />
          <HeadlineStat
            label="Cost ratio"
            big={b.totalCostUsd > 0 ? `${(a.totalCostUsd / b.totalCostUsd).toFixed(2)}×` : "—"}
            sub={`${a.strategy} costs ${a.totalCostUsd > b.totalCostUsd ? "more" : "less"} per run`}
            tier={a.totalCostUsd <= b.totalCostUsd ? "good" : "bad"}
          />
        </div>
      </Card>

      {datasetOverlap.mismatch ? (
        <Card
          title="Dataset mismatch"
          right={<span className="mono muted">case-win counts use overlap only</span>}
          style={{ marginBottom: 22 }}
        >
          <div style={{ color: "var(--ink-2)", fontSize: 13, lineHeight: 1.6 }}>
            Run A has {a.cases.length} cases and Run B has {b.cases.length}. They share {datasetOverlap.ids.length} case
            {datasetOverlap.ids.length === 1 ? "" : "s"}. The run-level macro and field aggregates are still shown, but
            they are not an apples-to-apples prompt decision when the datasets differ.
          </div>
        </Card>
      ) : null}

      <div className="delta-strip" style={{ marginBottom: 22 }}>
        <div className="delta-row head">
          <div>Field</div>
          <div style={{ textAlign: "right" }}>{a.strategy}</div>
          <div>{b.strategy}</div>
          <div style={{ textAlign: "right" }}>Δ</div>
          <div style={{ textAlign: "right" }}>Winner</div>
        </div>
        {compare.fields.map((row) => {
          const av = row.leftScore;
          const bv = row.rightScore;
          const d = row.delta;
          const w = row.winner;
          return (
            <div key={row.field} className="delta-row">
              <div className="delta-field">
                {row.field.replace(/_/g, " ")}
                <span className="sub">{FIELD_HELP[row.field] ?? "fuzzy token-set"}</span>
              </div>
              <div style={{ paddingRight: 0 }}>
                <Diverge value={av} compare={bv} side="left" color={STRATEGY_COLOR[a.strategy] ?? "#1B1A17"} />
              </div>
              <div>
                <Diverge value={bv} compare={av} side="right" color={STRATEGY_COLOR[b.strategy] ?? "#1B1A17"} />
              </div>
              <div
                className="delta-num"
                style={{ color: Math.abs(d) < 0.03 ? "var(--ink-3)" : d > 0 ? "var(--good)" : "var(--bad)" }}
              >
                {d >= 0 ? "+" : ""}
                {d.toFixed(3)}
                <span className="sub">{Math.abs(d) < 0.03 ? "within tie band" : "decisive"}</span>
              </div>
              <div style={{ textAlign: "right" }}>
                {w === "tie" ? (
                  <span className="winner" style={{ background: "var(--paper-2)", color: "var(--ink-3)" }}>
                    tie
                  </span>
                ) : (
                  <span className="winner" style={{ background: "var(--good-tint)", color: "var(--good)" }}>
                    {w === "left" ? a.strategy : b.strategy}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 20 }}>
        <Card
          title="Cases where strategies disagree most"
          right={<span className="mono muted">{datasetOverlap.mismatch ? "shared cases only" : "candidates for re-annotation"}</span>}
          flush
        >
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Case</th>
                  <th className="right">{a.strategy}</th>
                  <th className="right">{b.strategy}</th>
                  <th className="right">|Δ|</th>
                  <th>Winner</th>
                </tr>
              </thead>
              <tbody>
                {caseRows.slice(0, 8).map((r) => (
                  <tr key={r.cid} className="row-link">
                    <td className="mono" style={{ fontSize: 12 }}>
                      <Link href={`/runs/${a.id}/cases/${r.cid}`} style={{ display: "block" }}>
                        {r.cid}
                      </Link>
                    </td>
                    <td className="num" style={{ color: r.w === "a" ? "var(--good)" : "var(--ink-2)" }}>
                      {r.av.toFixed(3)}
                    </td>
                    <td className="num" style={{ color: r.w === "b" ? "var(--good)" : "var(--ink-2)" }}>
                      {r.bv.toFixed(3)}
                    </td>
                    <td className="num">{Math.abs(r.d).toFixed(3)}</td>
                    <td>
                      {r.w === "tie" ? (
                        <span className="tag plain">tie</span>
                      ) : (
                        <StrategyTag s={(r.w === "a" ? a : b).strategy} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Cost / quality / hallucination tradeoff">
          <CostQualityRow label={`${a.strategy} (A)`} run={a} color={STRATEGY_COLOR[a.strategy] ?? "#1B1A17"} />
          <div style={{ height: 12 }} />
          <CostQualityRow label={`${b.strategy} (B)`} run={b} color={STRATEGY_COLOR[b.strategy] ?? "#1B1A17"} />

          <div className="divider" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <SmallKV
              label="Cache read Δ"
              value={`${(((a.cacheReadInputTokens ?? 0) - (b.cacheReadInputTokens ?? 0)) / 1000).toFixed(0)}k`}
              sub={`${a.strategy} vs ${b.strategy}`}
            />
            <SmallKV
              label="Hallucination Δ"
              value={`${a.hallucinationCount - b.hallucinationCount >= 0 ? "+" : ""}${a.hallucinationCount - b.hallucinationCount}`}
              sub="lower is better"
              tier={
                a.hallucinationCount - b.hallucinationCount < 0
                  ? "good"
                  : a.hallucinationCount - b.hallucinationCount > 0
                    ? "bad"
                    : "neutral"
              }
            />
            <SmallKV label="Schema fail Δ" value={fmt.pct(compare.schemaFailureDelta)} sub="lower is better" />
          </div>
        </Card>
      </div>
    </div>
  );
}

function RunPicker({
  label,
  runs,
  value,
  onChange,
  run,
}: {
  label: string;
  runs: RunListItem[];
  value: string;
  onChange: (id: string) => void;
  run: RunDetailDto;
}) {
  return (
    <div className="run-pill">
      <div className="row">
        <div
          className="mono muted"
          style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em" }}
        >
          {label}
        </div>
        <select
          className="select"
          style={{ marginLeft: "auto", width: "auto", padding: "4px 8px", fontSize: 12, fontFamily: "var(--mono)" }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {runs.map((x) => (
            <option key={x.id} value={x.id}>
              {x.id.slice(0, 12)} · {x.strategy}
            </option>
          ))}
        </select>
      </div>
      <div className="row" style={{ marginTop: 4 }}>
        <StrategyTag s={run.strategy} />
        <span className="id">{run.id.slice(0, 12)}</span>
      </div>
      <div className="macro">{fmt.num(run.macroFieldScore)}</div>
      <div className="muted-row">
        <span>{fmt.date(run.completedAt)}</span>
        <span>{run.cases.length} cases</span>
        <span>${run.totalCostUsd.toFixed(3)}</span>
        <span>{run.hallucinationCount} flags</span>
      </div>
    </div>
  );
}

function HeadlineStat({
  label,
  big,
  sub,
  tier = "neutral",
}: {
  label: string;
  big: string;
  sub: string;
  tier?: "good" | "bad" | "neutral";
}) {
  const color = tier === "good" ? "var(--good)" : tier === "bad" ? "var(--bad)" : "var(--ink)";
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 32,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
          color,
        }}
      >
        {big}
      </div>
      <div className="mono muted" style={{ fontSize: 11 }}>
        {sub}
      </div>
    </div>
  );
}

function Diverge({
  value,
  compare,
  side,
  color,
}: {
  value: number;
  compare: number;
  side: "left" | "right";
  color: string;
}) {
  const w = (value / 1) * 50;
  const better = value > compare;
  const labelOffset = `calc(50% + ${w}% + 8px)`;
  return (
    <div className="diverge">
      <div className="center" />
      <div
        className="bar"
        style={{
          [side === "left" ? "right" : "left"]: "50%",
          width: `${w}%`,
          background: better ? color : color + "55",
        }}
      />
      <div
        className="label"
        style={{
          [side === "left" ? "right" : "left"]: labelOffset,
          color: better ? color : "var(--ink-3)",
        }}
      >
        {value.toFixed(3)}
      </div>
    </div>
  );
}

function CostQualityRow({ label, run, color }: { label: string; run: RunDetailDto; color: string }) {
  const macro = run.macroFieldScore ?? 0;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 500, fontSize: 13 }}>{label}</span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          F1 {macro.toFixed(3)} · ${run.totalCostUsd.toFixed(3)} · {run.hallucinationCount} flags
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "60px 1fr",
          gap: 8,
          alignItems: "center",
          fontFamily: "var(--mono)",
          fontSize: 10.5,
        }}
      >
        <span className="muted">quality</span>
        <div style={{ height: 6, background: "var(--paper-2)", borderRadius: 2, position: "relative" }}>
          <div style={{ position: "absolute", inset: "0 auto 0 0", width: `${macro * 100}%`, background: color, borderRadius: 2 }} />
        </div>
        <span className="muted">cost</span>
        <div style={{ height: 6, background: "var(--paper-2)", borderRadius: 2, position: "relative" }}>
          <div
            style={{
              position: "absolute",
              inset: "0 auto 0 0",
              width: `${Math.min(100, (run.totalCostUsd / 0.5) * 100)}%`,
              background: "var(--ink-3)",
              borderRadius: 2,
            }}
          />
        </div>
        <span className="muted">hallu.</span>
        <div style={{ height: 6, background: "var(--paper-2)", borderRadius: 2, position: "relative" }}>
          <div
            style={{
              position: "absolute",
              inset: "0 auto 0 0",
              width: `${Math.min(100, (run.hallucinationCount / 150) * 100)}%`,
              background: "var(--bad)",
              borderRadius: 2,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function SmallKV({
  label,
  value,
  sub,
  tier = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tier?: "good" | "bad" | "neutral";
}) {
  const color = tier === "good" ? "var(--good)" : tier === "bad" ? "var(--bad)" : "var(--ink)";
  return (
    <div>
      <div className="mono muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 18, fontVariantNumeric: "tabular-nums", color, marginTop: 2 }}>
        {value}
      </div>
      <div className="mono muted" style={{ fontSize: 11 }}>
        {sub}
      </div>
    </div>
  );
}
