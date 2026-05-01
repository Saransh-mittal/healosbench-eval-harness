import Link from "next/link";

import { getCase, getRun } from "@/lib/api";
import CaseDetailView from "./case-detail-view";

export default async function CasePage({ params }: { params: Promise<{ id: string; caseId: string }> }) {
  const { id, caseId } = await params;
  const [run, detail] = await Promise.all([getRun(id), getCase(id, caseId)]);

  if (!run || !detail) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="page-eyebrow">Case not found</div>
            <h1 className="page-title">Nothing to show.</h1>
            <p className="page-sub">
              <Link href={`/runs/${id}`} style={{ textDecoration: "underline" }}>
                ← Back to run
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <CaseDetailView run={run} detail={detail} />;
}
