import assert from "node:assert/strict";
import test from "node:test";
import { captureConfigFor } from "../../src/lib/capture/apps";

test("a discovered app has an explicit login handoff and preserves the signed-in page", () => {
  const config = captureConfigFor("app_324684580", "https://www.spotify.com/", "https://www.spotify.com");
  // A generic app has no reliable automatic login signal. It must provide a
  // foreground confirmation instead of waiting forever for loggedIn=true.
  const automatic = !!(config.loggedIn.probe || config.loggedIn.loggedInPaths?.length || config.loggedIn.domSelectors?.length);
  assert.ok(automatic || config.loggedIn.manual);
  assert.deepEqual(config.playbook.filter((step) => step.kind === "visit"), [], "do not leave the user's signed-in page for the seller homepage");
});

test("known integrations retain their automatic login detectors and capture playbooks", () => {
  for (const slug of ["myfitnesspal", "parkmobile", "duolingo", "cronometer"]) {
    const config = captureConfigFor(slug);
    assert.ok(config.loggedIn.probe || config.loggedIn.loggedInPaths?.length || config.loggedIn.domSelectors?.length, slug);
    assert.ok(!config.loggedIn.manual, slug);
    assert.ok(config.playbook.length, slug);
  }
});
