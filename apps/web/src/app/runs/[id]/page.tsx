import Link from "next/link";

import { getCase, getRun } from "@/lib/api";

function score(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : value.toFixed(3);
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[520px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ case?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const run = await getRun(id);
  if (!run) return <div className="p-6">Run not found.</div>;
  const selectedId = query.case ?? run.cases[0]?.transcriptId;
  const selected = selectedId ? await getCase(id, selectedId) : null;

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6">
      <div className="grid gap-1">
        <Link href="/" className="text-sm underline">
          Back to runs
        </Link>
        <h1 className="text-2xl font-semibold">{run.strategy}</h1>
        <p className="font-mono text-xs text-muted-foreground">
          {run.id} · {run.model} · {run.promptHash}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Macro</div>
          <div className="text-xl font-semibold">{score(run.macroFieldScore)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Schema Fail</div>
          <div className="text-xl font-semibold">{run.schemaFailureRate === null ? "-" : `${(run.schemaFailureRate * 100).toFixed(1)}%`}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Hallucinations</div>
          <div className="text-xl font-semibold">{run.hallucinationCount}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Cost</div>
          <div className="text-xl font-semibold">${run.totalCostUsd.toFixed(4)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Cache Read</div>
          <div className="text-xl font-semibold">{(run.cacheReadRatio * 100).toFixed(1)}%</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th className="p-3">Case</th>
              <th className="p-3">Score</th>
              <th className="p-3">Chief</th>
              <th className="p-3">Vitals</th>
              <th className="p-3">Meds</th>
              <th className="p-3">Dx</th>
              <th className="p-3">Plan</th>
              <th className="p-3">Follow-up</th>
              <th className="p-3">Halluc.</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {run.cases.map((item) => (
              <tr key={item.id} className={item.transcriptId === selectedId ? "border-t bg-muted/40" : "border-t"}>
                <td className="p-3 font-mono text-xs">
                  <Link className="underline" href={`/runs/${run.id}?case=${item.transcriptId}`}>
                    {item.transcriptId}
                  </Link>
                </td>
                <td className="p-3">{score(item.macroScore)}</td>
                <td className="p-3">{score(item.fieldScores?.chief_complaint.score)}</td>
                <td className="p-3">{score(item.fieldScores?.vitals.score)}</td>
                <td className="p-3">{score(item.fieldScores?.medications.score)}</td>
                <td className="p-3">{score(item.fieldScores?.diagnoses.score)}</td>
                <td className="p-3">{score(item.fieldScores?.plan.score)}</td>
                <td className="p-3">{score(item.fieldScores?.follow_up.score)}</td>
                <td className="p-3">{item.hallucinationCount}</td>
                <td className="p-3">{item.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div className="grid gap-4">
          <h2 className="text-xl font-semibold">{selected.transcriptId}</h2>
          <div className="rounded-md border p-3">
            <h3 className="mb-2 font-medium">Transcript</h3>
            <p className="whitespace-pre-wrap text-sm leading-6">{selected.transcript}</p>
          </div>
          {selected.hallucinations.length > 0 ? (
            <div className="rounded-md border border-destructive/50 p-3">
              <h3 className="mb-2 font-medium">Hallucination Flags</h3>
              <ul className="grid gap-1 text-sm">
                {selected.hallucinations.map((item) => (
                  <li key={`${item.path}-${item.value}`}>
                    <span className="font-mono">{item.path}</span>: {item.value}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 font-medium">Gold</h3>
              <JsonBlock value={selected.gold} />
            </div>
            <div>
              <h3 className="mb-2 font-medium">Prediction</h3>
              <JsonBlock value={selected.prediction} />
            </div>
          </div>
          <div>
            <h3 className="mb-2 font-medium">LLM Trace</h3>
            <JsonBlock value={selected.attempts} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
