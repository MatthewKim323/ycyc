/// <reference types="node" />
import test from "node:test";
import assert from "node:assert/strict";
import { loginChallenge } from "../../convex/lib/providerCli";
import { openProvider, sealProvider } from "../../convex/lib/providerVault";

test("provider envelopes bind credentials to their owner and purpose", () => {
  const previous = process.env.AI_SESSION_ENCRYPTION_KEY;
  process.env.AI_SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
  try {
    const cipher = sealProvider('{"token":"private"}', "alice:claude:credentials");
    assert.ok(!cipher.includes("private"));
    assert.equal(openProvider(cipher, "alice:claude:credentials"), '{"token":"private"}');
    assert.throws(() => openProvider(cipher, "bob:claude:credentials"));
    assert.throws(() => openProvider(cipher, "alice:codex:credentials"));
    assert.throws(() => openProvider(cipher, "alice:claude:code:attempt"));
    const parts = cipher.split(".");
    parts[3] = Buffer.from("changed").toString("base64url");
    assert.throws(() => openProvider(parts.join("."), "alice:claude:credentials"));
    assert.notEqual(sealProvider("same", "scope"), sealProvider("same", "scope"));
  } finally {
    if (previous === undefined) delete process.env.AI_SESSION_ENCRYPTION_KEY;
    else process.env.AI_SESSION_ENCRYPTION_KEY = previous;
  }
});

test("missing or malformed encryption keys fail closed", () => {
  const previous = process.env.AI_SESSION_ENCRYPTION_KEY;
  try {
    for (const key of ["", "not-a-key"]) {
      process.env.AI_SESSION_ENCRYPTION_KEY = key;
      assert.throws(() => sealProvider("secret", "scope"), /not_configured/);
    }
  } finally {
    if (previous === undefined) delete process.env.AI_SESSION_ENCRYPTION_KEY;
    else process.env.AI_SESSION_ENCRYPTION_KEY = previous;
  }
});

test("Claude uses the native remote-code URL without rewriting OAuth parameters", () => {
  const link = "https://claude.ai/oauth/authorize?code=true&state=opaque&code_challenge=challenge";
  assert.deepEqual(loginChallenge("claude", `Open browser:\n\u001b[32m${link}\u001b[0m\nPaste code here:`), { loginUrl: link });
  const currentLink = "https://claude.com/cai/oauth/authorize?code=true&state=opaque&code_challenge=challenge";
  assert.deepEqual(loginChallenge("claude", `If the browser didn’t open, visit: ${currentLink}\nPaste code here if prompted >`), { loginUrl: currentLink });
  assert.equal(loginChallenge("claude", "https://claude.com/unrelated?code=true"), null);
  assert.equal(loginChallenge("claude", "https://claude.com.evil.invalid/cai/oauth/authorize?code=true"), null);
  assert.equal(loginChallenge("claude", "https://claude.ai/oauth/authorize?redirect_uri=http://localhost/callback"), null);
  assert.equal(loginChallenge("claude", "https://claude.ai.evil.invalid/oauth/authorize?code=true"), null);
  assert.equal(loginChallenge("claude", "https://attacker@claude.ai/oauth/authorize?code=true"), null);
});

test("Codex challenges require both an official device page and its short code", () => {
  assert.deepEqual(loginChallenge("codex", "Go to https://auth.openai.com/codex/device\nEnter ABCD-EFGHI"), {
    loginUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-EFGHI",
  });
  assert.equal(loginChallenge("codex", "https://auth.openai.com/codex/device"), null);
  assert.equal(loginChallenge("codex", "https://example.invalid/device ABCD-EFGHI"), null);
  assert.equal(loginChallenge("codex", "https://auth.openai.com:8443/device ABCD-EFGHI"), null);
});
