import Link from "next/link";

import { getRun } from "@/lib/api";
import RunDetailView from "./run-detail-view";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);

  if (!run) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="page-eyebrow">Run not found</div>
            <h1 className="page-title">Nothing to show.</h1>
            <p className="page-sub">
              That run id doesn&apos;t exist on this server. <Link href="/" style={{ textDecoration: "underline" }}>Back to runs</Link>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <RunDetailView run={run} />;
}
