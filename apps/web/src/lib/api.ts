import type { CaseDetailDto, CompareRunDto, RunDetailDto, RunListItem } from "@test-evals/shared";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787";

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${SERVER_URL}${path}`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function getRuns(): Promise<RunListItem[]> {
  return (await getJson<RunListItem[]>("/api/v1/runs")) ?? [];
}

export async function getRun(id: string): Promise<RunDetailDto | null> {
  return getJson<RunDetailDto>(`/api/v1/runs/${id}`);
}

export async function getCase(runId: string, transcriptId: string): Promise<CaseDetailDto | null> {
  return getJson<CaseDetailDto>(`/api/v1/runs/${runId}/cases/${transcriptId}`);
}

export async function getCompare(left: string, right: string): Promise<CompareRunDto | null> {
  return getJson<CompareRunDto>(`/api/v1/runs/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`);
}
