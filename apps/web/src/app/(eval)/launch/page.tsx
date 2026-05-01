import { getRuns } from "@/lib/api";
import LauncherView from "./launcher-view";

export default async function LaunchPage() {
  const runs = await getRuns();
  return <LauncherView runs={runs} />;
}
