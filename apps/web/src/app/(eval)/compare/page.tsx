import { getCompare, getRun, getRuns } from "@/lib/api";
import CompareView from "./compare-view";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ left?: string; right?: string }>;
}) {
  const query = await searchParams;
  const runs = await getRuns();
  const left = query.left ?? runs[0]?.id;
  const right = query.right ?? runs[1]?.id ?? runs[0]?.id;
  const compare = left && right ? await getCompare(left, right) : null;
  const [leftDetail, rightDetail] = await Promise.all([
    left ? getRun(left) : null,
    right ? getRun(right) : null,
  ]);

  return (
    <CompareView
      runs={runs}
      compare={compare}
      leftDetail={leftDetail}
      rightDetail={rightDetail}
      defaultLeft={left ?? null}
      defaultRight={right ?? null}
    />
  );
}
