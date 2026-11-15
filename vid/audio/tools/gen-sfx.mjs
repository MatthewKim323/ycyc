#!/usr/bin/env node
// node audio/tools/gen-sfx.mjs [id...]  ->  assets/sfx/<id>.mp3 via ElevenLabs sound generation.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const list = JSON.parse(await readFile(join(ROOT, "audio", "sfx.json"), "utf8"));
const only = process.argv.slice(2);
for (const sfx of list) {
  if (only.length && !only.includes(sfx.id)) continue;
  const out = join(ROOT, "assets", "sfx", `${sfx.id}.mp3`);
  if (existsSync(out)) continue;
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ text: sfx.text, duration_seconds: sfx.duration, loop: !!sfx.loop, prompt_influence: 0.45, model_id: "eleven_text_to_sound_v2" }),
  });
  if (!res.ok) { console.error(sfx.id, res.status, await res.text()); continue; }
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log(`${sfx.id}: ${sfx.duration}s`);
}
