"use node";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const bytes = Buffer.from(process.env.AI_SESSION_ENCRYPTION_KEY ?? "", "base64url");
  if (bytes.length !== 32) throw new Error("provider_storage_not_configured");
  return bytes;
}

// Bind each envelope to its owner, provider and purpose. Swapping another
// account's ciphertext or a login-code envelope into a credential slot fails.
export function sealProvider(value: string, scope: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(scope));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function openProvider(envelope: string, scope: string) {
  const [version, iv, tag, data, extra] = envelope.split(".");
  if (version !== "v1" || !iv || !tag || !data || extra !== undefined || envelope.length > 2_000_000) throw new Error("invalid_provider_envelope");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(scope));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
