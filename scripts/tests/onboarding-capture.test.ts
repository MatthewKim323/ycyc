/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionPhase } from "../../src/components/onboarding/connection-phase";

const webCapture = { status: "needs_login", isWeb: true, loggedIn: false, failed: false };

test("login progress keeps the capture browser alive until its session is submitted", () => {
  const beforeLogin = connectionPhase(webCapture);
  const loggedIn = connectionPhase({ ...webCapture, loggedIn: true });
  const capturing = connectionPhase({ ...webCapture, status: "capturing", loggedIn: true });
  assert.equal(beforeLogin.phase, "signin");
  assert.equal(loggedIn.phase, "build");
  // The former phase === signin mount condition cancelled capture at this point.
  assert.notEqual(loggedIn.phase, "signin");
  for (const presentation of [beforeLogin, loggedIn, capturing]) {
    assert.equal(presentation.keepCaptureMounted, true);
    assert.equal(presentation.captureReady, false);
  }
  const saved = connectionPhase({ ...webCapture, status: "building", loggedIn: true });
  assert.equal(saved.keepCaptureMounted, false);
  assert.equal(saved.phase, "build");
});

test("saving a private capture hands off when the backend is done, instead of spinning", () => {
  const waiting = connectionPhase({ ...webCapture, status: "capturing", loggedIn: true, buildStatus: "running" });
  assert.equal(waiting.keepCaptureMounted, true);
  const ready = connectionPhase({ ...webCapture, status: "capturing", loggedIn: true, buildStatus: "done" });
  assert.equal(ready.captureReady, true);
  assert.equal(ready.preSubmit, false);
  assert.equal(ready.keepCaptureMounted, false);
});

test("submit failure exposes retry and a retry can mount a fresh capture", () => {
  const failed = connectionPhase({ ...webCapture, loggedIn: true, failed: true });
  assert.equal(failed.phase, "error");
  assert.equal(failed.keepCaptureMounted, false);
  const retry = connectionPhase(webCapture);
  assert.equal(retry.phase, "signin");
  assert.equal(retry.keepCaptureMounted, true);
});

test("code prompts and terminal states release the browser; native credentials do not mount it", () => {
  for (const status of ["needs_code", "live", "error", "disconnected", undefined]) {
    assert.equal(connectionPhase({ ...webCapture, status, loggedIn: true }).keepCaptureMounted, false);
  }
  assert.equal(connectionPhase({ ...webCapture, status: "needs_code" }).phase, "code");
  assert.equal(connectionPhase({ ...webCapture, isWeb: false, loggedIn: true }).keepCaptureMounted, false);
  assert.equal(connectionPhase({ ...webCapture, isWeb: false, loggedIn: true }).phase, "signin");
});
