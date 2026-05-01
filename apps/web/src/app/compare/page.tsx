import Link from "next/link";

import { getCompare, getRuns } from "@/lib/api";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ left?: string; right?: string }>;
}) {
  const query = await searchParams;
  const runs = await getRuns();
  const left = query.left ?? runs[1]?.id ?? runs[0]?.id;
  const right = query.right ?? runs[0]?.id;
  const compare = left && right ? await getCompare(left, right) : null;

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Compare Runs</h1>
        <p className="text-sm text-muted-foreground">Winner labels require an absolute delta above 0.03; otherwise the field is a tie.</p>
      </div>

      <form className="grid gap-3 rounded-md border p-4 md:grid-cols-[1fr_1fr_auto]" action="/compare">
        <label className="grid gap-1 text-sm">
          Left run
          <select className="h-9 rounded-md border bg-background px-2 font-mono text-xs" name="left" defaultValue={left}>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.strategy} · {run.id}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Right run
          <select className="h-9 rounded-md border bg-background px-2 font-mono text-xs" name="right" defaultValue={right}>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.strategy} · {run.id}
              </option>
            ))}
          </select>
        </label>
        <button className="mt-6 h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground" type="submit">
          Compare
        </button>
      </form>

      {compare ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Left</div>
              <Link href={`/runs/${compare.left.id}`} className="font-mono text-sm underline">
                {compare.left.id}
              </Link>
              <div>{compare.left.strategy} · macro {compare.left.macroFieldScore?.toFixed(3) ?? "-"}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Right</div>
              <Link href={`/runs/${compare.right.id}`} className="font-mono text-sm underline">
                {compare.right.id}
              </Link>
              <div>{compare.right.strategy} · macro {compare.right.macroFieldScore?.toFixed(3) ?? "-"}</div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-muted/60 text-left">
                <tr>
                  <th className="p-3">Field</th>
                  <th className="p-3">Left</th>
                  <th className="p-3">Right</th>
                  <th className="p-3">Delta</th>
                  <th className="p-3">Winner</th>
                  <th className="p-3">Left Case Wins</th>
                  <th className="p-3">Right Case Wins</th>
                  <th className="p-3">Ties</th>
                </tr>
              </thead>
              <tbody>
                {compare.fields.map((field) => (
                  <tr key={field.field} className="border-t">
                    <td className="p-3 font-medium">{field.field}</td>
                    <td className="p-3">{field.leftScore.toFixed(3)}</td>
                    <td className="p-3">{field.rightScore.toFixed(3)}</td>
                    <td className={field.delta >= 0 ? "p-3 text-green-700" : "p-3 text-destructive"}>{field.delta.toFixed(3)}</td>
                    <td className="p-3">{field.winner}</td>
                    <td className="p-3">{field.leftCaseWins}</td>
                    <td className="p-3">{field.rightCaseWins}</td>
                    <td className="p-3">{field.ties}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border p-3">Schema failure delta: {pct(compare.schemaFailureDelta)}</div>
            <div className="rounded-md border p-3">Hallucination delta: {compare.hallucinationDelta}</div>
          </div>
        </>
      ) : (
        <div className="rounded-md border p-4 text-sm">Run at least two evals, then open this page again.</div>
      )}
    </div>
  );
}
