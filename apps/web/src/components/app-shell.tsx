"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Icon } from "./primitives";

const NAV = [
  { href: "/", label: "Runs", icon: "list" as const, key: "runs" },
  { href: "/compare", label: "Compare", icon: "compare" as const, key: "compare", count: "A/B" },
  { href: "/launch", label: "New run", icon: "flask" as const, key: "launch" },
];

function activeKey(pathname: string): string {
  if (pathname === "/" || pathname.startsWith("/runs")) return "runs";
  if (pathname.startsWith("/compare")) return "compare";
  if (pathname.startsWith("/launch")) return "launch";
  return "";
}

function Crumbs({ pathname }: { pathname: string }) {
  const items: { label: string; href?: string }[] = [{ label: "HEALOSBENCH", href: "/" }];

  if (pathname === "/") {
    items.push({ label: "runs" });
  } else if (pathname.startsWith("/compare")) {
    items.push({ label: "compare" });
  } else if (pathname.startsWith("/launch")) {
    items.push({ label: "new run" });
  } else if (pathname.startsWith("/runs/")) {
    items.push({ label: "runs", href: "/" });
    const parts = pathname.split("/").filter(Boolean);
    const runId = parts[1];
    const short = runId ? runId.slice(0, 12) : "";
    if (parts.length === 2) {
      items.push({ label: short });
    } else if (parts[2] === "cases" && parts[3]) {
      items.push({ label: short, href: `/runs/${runId}` });
      items.push({ label: parts[3] });
    } else {
      items.push({ label: short });
    }
  }

  return (
    <div className="crumbs">
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <span key={`${item.label}-${idx}`} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            {idx > 0 ? <span className="sep">/</span> : null}
            {item.href && !isLast ? (
              <Link className="crumb-link" href={item.href as Route}>
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "current" : "crumb-link"}>{item.label}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [menuOpen, setMenuOpen] = useState(false);
  const active = activeKey(pathname);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const currentLabel =
    active === "runs" && pathname === "/"
      ? "runs"
      : active === "compare"
        ? "compare"
        : active === "launch"
          ? "new run"
          : pathname.startsWith("/runs/")
            ? pathname.split("/")[2]?.slice(0, 12) ?? "run"
            : "";

  return (
    <div className="app">
      <div
        className={`scrim${menuOpen ? " open" : ""}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden
      />
      <aside className={`sidebar${menuOpen ? " open" : ""}`}>
        <div className="brand">
          <div className="brand-mark" />
          <Link href="/" className="brand-name">
            HEAL<span className="accent">OS</span>BENCH
          </Link>
        </div>

        <div className="nav-section">Workspace</div>
        {NAV.map((item) => (
          <Link key={item.key} href={item.href as Route} className={`nav-item${active === item.key ? " active" : ""}`}>
            <span className="nav-left">
              <span className="nav-icon">
                {item.icon === "list" ? <Icon.list /> : item.icon === "compare" ? <Icon.compare /> : <Icon.flask />}
              </span>
              {item.label}
            </span>
            {item.count ? <span className="nav-count">{item.count}</span> : null}
          </Link>
        ))}

        <div className="nav-section">Dataset</div>
        <div className="nav-item">
          <span className="nav-left">
            <span className="nav-icon">·</span>Transcripts
          </span>
          <span className="nav-count">50</span>
        </div>
        <div className="nav-item">
          <span className="nav-left">
            <span className="nav-icon">·</span>Gold
          </span>
          <span className="nav-count">50</span>
        </div>
        <div className="nav-item">
          <span className="nav-left">
            <span className="nav-icon">·</span>Schema
          </span>
          <span className="nav-count mono" style={{ fontSize: 10 }}>
            v1
          </span>
        </div>

        <div className="nav-section">Strategies</div>
        <div className="nav-item">
          <span className="nav-left">
            <span className="nav-icon" style={{ color: "var(--teal)" }}>
              ●
            </span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>zero_shot</span>
          </span>
        </div>
        <div className="nav-item">
          <span className="nav-left">
            <span className="nav-icon" style={{ color: "var(--violet)" }}>
              ●
            </span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>few_shot</span>
          </span>
        </div>
        <div className="nav-item">
          <span className="nav-left">
            <span className="nav-icon" style={{ color: "var(--rust)" }}>
              ●
            </span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>cot</span>
          </span>
        </div>

        <div className="sidebar-foot">
          <div className="row">
            <span>build</span>
            <span>0.4.1</span>
          </div>
          <div className="row">
            <span>db</span>
            <span>postgres</span>
          </div>
          <div className="row">
            <span>server</span>
            <span>:8787</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="mobile-bar">
          <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <span />
          </button>
          <div className="brand-name">
            HEAL<span style={{ color: "var(--teal)" }}>OS</span>BENCH
          </div>
          <div style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
            {currentLabel}
          </div>
        </div>

        <div className="topbar">
          <Crumbs pathname={pathname} />
          <div className="topbar-right">
            <span>
              <span className="pulse-dot" style={{ verticalAlign: "middle", marginRight: 6 }} />
              server :8787
            </span>
          </div>
        </div>

        {children}
      </main>
    </div>
  );
}
