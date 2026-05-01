import type { CSSProperties, ReactNode } from "react";

export const fmt = {
  pct: (v: number | null | undefined): string =>
    v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`,
  num: (v: number | null | undefined, d = 3): string =>
    v === null || v === undefined ? "—" : v.toFixed(d),
  tokens: (n: number | null | undefined): string =>
    n === null || n === undefined ? "—" : n.toLocaleString("en-US"),
  usd: (v: number | null | undefined): string =>
    v === null || v === undefined ? "—" : `$${v.toFixed(4)}`,
  date: (v: string | Date | null | undefined): string =>
    v === null || v === undefined
      ? "—"
      : new Intl.DateTimeFormat("en-US", {
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(v)),
  dateTime: (v: string | Date | null | undefined): string =>
    v === null || v === undefined
      ? "—"
      : new Intl.DateTimeFormat("en-US", {
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
          timeZone: "UTC",
        }).format(new Date(v)),
};

export function scoreTier(s: number | null | undefined): "good" | "warn" | "bad" {
  if (s === null || s === undefined) return "bad";
  if (s >= 0.8) return "good";
  if (s >= 0.6) return "warn";
  return "bad";
}

export function ScoreBar({
  value,
  width = 140,
  showNum = true,
  tier,
}: {
  value: number | null | undefined;
  width?: number;
  showNum?: boolean;
  tier?: "good" | "warn" | "bad";
}) {
  const v = value ?? 0;
  const t = tier ?? scoreTier(value);
  return (
    <span className={`score-bar ${t}`} style={{ width }}>
      <span className="track">
        <span className="fill" style={{ width: `${Math.max(2, v * 100)}%` }} />
      </span>
      {showNum && <span className="num">{value === null || value === undefined ? "—" : v.toFixed(3)}</span>}
    </span>
  );
}

export function StrategyTag({ s }: { s: string }) {
  return (
    <span className={`tag ${s}`}>
      <span className="dot" />
      {s}
    </span>
  );
}

export function StatusTag({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "ok",
    complete: "ok",
    done: "ok",
    running: "warn",
    pending: "plain",
    extracting: "warn",
    extracted: "warn",
    scoring: "warn",
    failed: "bad",
    canceled: "plain",
  };
  return <span className={`tag ${map[status] ?? "plain"}`}>{status}</span>;
}

export const Icon = {
  list: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  compare: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M3 2v10M11 2v10M5.5 4.5h-2M10.5 9.5h-2M5.5 7h-2M10.5 7h-2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  ),
  flask: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M5.5 2v3.5L2.5 11a1 1 0 0 0 .9 1.5h7.2A1 1 0 0 0 11.5 11L8.5 5.5V2M4.5 2h5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  search: () => (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4" />
      <path d="m9 9 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  arrow: () => (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <path
        d="M3 6h6m-2.5-2.5L9 6 6.5 8.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  play: () => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <path d="M2 1.5v7l6-3.5z" />
    </svg>
  ),
  chev: () => (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="m4 3 4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  copy: () => (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <rect x="3" y="3" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 3V2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

function jsonToHtml(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (obj === null) return `<span class="nl">null</span>`;
  if (typeof obj === "boolean") return `<span class="b">${obj}</span>`;
  if (typeof obj === "number") return `<span class="n">${obj}</span>`;
  if (typeof obj === "string") return `<span class="s">"${escapeHtml(obj)}"</span>`;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    const items = obj.map((v) => `${pad}  ${jsonToHtml(v, indent + 1)}`);
    return `[\n${items.join(",\n")}\n${pad}]`;
  }
  if (typeof obj === "object") {
    const keys = Object.keys(obj as Record<string, unknown>);
    if (keys.length === 0) return "{}";
    const items = keys.map(
      (k) => `${pad}  <span class="k">"${escapeHtml(k)}"</span>: ${jsonToHtml((obj as Record<string, unknown>)[k], indent + 1)}`,
    );
    return `{\n${items.join(",\n")}\n${pad}}`;
  }
  return String(obj);
}

export function JsonBlock({ data, style }: { data: unknown; style?: CSSProperties }) {
  return <pre className="json-block" style={style} dangerouslySetInnerHTML={{ __html: jsonToHtml(data) }} />;
}

export function Card({
  title,
  eyebrow,
  right,
  children,
  flush,
  style,
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  flush?: boolean;
  style?: CSSProperties;
}) {
  const hasHead = title || eyebrow || right;
  return (
    <div className="hob-card" style={style}>
      {hasHead ? (
        <div className="card-head">
          {eyebrow ? <div className="card-eyebrow">{eyebrow}</div> : null}
          {title ? <div className="card-title">{title}</div> : null}
          {right ? <div style={{ marginLeft: "auto" }}>{right}</div> : null}
        </div>
      ) : null}
      <div className={`card-body${flush ? " flush" : ""}`}>{children}</div>
    </div>
  );
}

export function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
