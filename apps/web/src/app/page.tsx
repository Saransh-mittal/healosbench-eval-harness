import Link from "next/link";

import { getRuns } from "@/lib/api";
import RunLauncher from "./run-launcher";

function pct(value: number | null): string {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

export default async function Home() {
  const runs = await getRuns();
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">HEALOSBENCH Runs</h1>
        <p className="text-sm text-muted-foreground">Structured clinical extraction evals, scored by field.</p>
      </div>
      <RunLauncher />
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th className="p-3">Run</th>
              <th className="p-3">Strategy</th>
              <th className="p-3">Model</th>
              <th className="p-3">Macro</th>
              <th className="p-3">Case Avg</th>
              <th className="p-3">Schema Fail</th>
              <th className="p-3">Halluc.</th>
              <th className="p-3">Cost</th>
              <th className="p-3">Cache Read</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-t">
                <td className="p-3 font-mono text-xs">
                  <Link className="underline" href={`/runs/${run.id}`}>
                    {run.id}
                  </Link>
                </td>
                <td className="p-3">{run.strategy}</td>
                <td className="p-3 font-mono text-xs">{run.model}</td>
                <td className="p-3">{pct(run.macroFieldScore)}</td>
                <td className="p-3">{pct(run.averageCaseScore)}</td>
                <td className="p-3">{pct(run.schemaFailureRate)}</td>
                <td className="p-3">{run.hallucinationCount}</td>
                <td className="p-3">${run.totalCostUsd.toFixed(4)}</td>
                <td className="p-3">{pct(run.cacheReadRatio)}</td>
                <td className="p-3">{run.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
