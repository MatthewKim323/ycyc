/** Capture owns the browser until submitLogin saves the session or fails. */
export function connectionPhase({
  status, isWeb, loggedIn, buildStatus, failed,
}: {
  status: string | undefined;
  isWeb: boolean;
  loggedIn: boolean;
  buildStatus?: string;
  failed: boolean;
}) {
  const captureReady = status === "capturing" && buildStatus === "done";
  const preSubmit = status === "needs_login" || (status === "capturing" && !captureReady);
  const keepCaptureMounted = isWeb && preSubmit && !failed;
  const phase: "signin" | "code" | "build" | "error" = failed
    ? "error"
    : status === "needs_code"
      ? "code"
      : captureReady || status === "building" || status === "live"
        ? "build"
        : preSubmit
          ? isWeb && loggedIn ? "build" : "signin"
          : "error";
  return { phase, keepCaptureMounted, captureReady, preSubmit };
}
