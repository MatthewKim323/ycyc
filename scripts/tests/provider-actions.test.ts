import assert from "node:assert/strict";
import test from "node:test";
import { submitCode } from "../../convex/providerActions";

const row = {
  _id: "provider-session", userId: "alice", provider: "claude", status: "authorizing",
  attemptId: "current-attempt", loginExpiresAt: Date.now() + 60_000,
};
type Handler = (ctx: unknown, args: unknown) => Promise<unknown>;
const run = (submitCode as unknown as { _handler: Handler })._handler;
const input = { token: "fixture-capability", provider: "claude", attemptId: row.attemptId, code: "opaque-code#state" };

test("a code cancelled between ownership check and storage is not reported accepted", async () => {
  const previous = process.env.AI_SESSION_ENCRYPTION_KEY;
  process.env.AI_SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64url");
  let mutations = 0;
  try {
    const result = await run({
      runQuery: async () => row,
      runMutation: async (_reference: unknown, args: { codeCipher: string }) => {
        mutations++;
        assert.ok(!args.codeCipher.includes(input.code));
        return false; // A concurrent disconnect/retry invalidated the attempt.
      },
    }, input);
    assert.deepEqual(result, { ok: false });
    assert.equal(mutations, 1);
  } finally {
    if (previous === undefined) delete process.env.AI_SESSION_ENCRYPTION_KEY;
    else process.env.AI_SESSION_ENCRYPTION_KEY = previous;
  }
});

test("authorization code limit uses UTF-8 bytes before sealing or persistence", async () => {
  let mutations = 0;
  const result = await run({
    runQuery: async () => row,
    runMutation: async () => { mutations++; return true; },
  }, { ...input, code: "😀".repeat(1500) }); // 3,000 JS chars, 6,000 UTF-8 bytes.
  assert.deepEqual(result, { ok: false });
  assert.equal(mutations, 0);
});
