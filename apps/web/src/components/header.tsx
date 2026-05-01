"use client";
import Link from "next/link";

export default function Header() {
  const links = [
    { to: "/", label: "Runs" },
    { to: "/compare", label: "Compare" },
  ] as const;

  return (
    <div>
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav className="flex gap-4 text-lg">
          {links.map(({ to, label }) => {
            return (
              <Link key={to} href={to}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="font-mono text-xs text-muted-foreground">HEALOSBENCH</div>
      </div>
      <hr />
    </div>
  );
}
