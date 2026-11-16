"use node";

// Internal cloud-provider artifact transport. Signed URLs stay inside the
// backend; the agent sees only normalized, owner-scoped capture evidence.
import { safeNativeArtifactFetch } from "./learningHttp";

export async function fetchNativeArtifactText(url: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new Error("native_artifact_cancelled");
  const result = await safeNativeArtifactFetch(url);
  if (signal.aborted) throw new Error("native_artifact_cancelled");
  if (result.status !== 200) throw new Error("native_artifact_unavailable");
  return result.text;
}
