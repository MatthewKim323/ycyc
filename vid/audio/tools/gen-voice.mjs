#!/usr/bin/env node
// node audio/tools/gen-voice.mjs <voiceName> <elevenLabsVoiceId> [takes=1] [lineId...]
//   reads audio/voice/script.json  [{ "id": "o1", "text": "...", "style": "warm, calm" }]
//   writes audio/voice/<voiceName>/<id>-t<n>.mp3 (skips takes that exist; ELEVENLABS_API_KEY from ~/.zshenv)
// Ported from ~/dev/nautshow1/audio/tools/gen-narrator.mjs (eleven_v3, audio tags for delivery).
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "voice");
const [name, voice, takesArg, ...only] = process.argv.slice(2);
if (!name || !voice) { console.error("usage: gen-voice.mjs <voiceName> <voiceId> [takes] [lineId...]"); process.exit(1); }
const takes = Number(takesArg || 1);
const lines = JSON.parse(await readFile(join(DIR, "script.json"), "utf8"));
await mkdir(join(DIR, name), { recursive: true });
for (const line of lines) {
  if (only.length && !only.includes(line.id)) continue;
  for (let n = 1; n <= takes; n++) {
    const out = join(DIR, name, `${line.id}-t${n}.mp3`);
    if (existsSync(out)) continue;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ text: `[${line.style || "warm, calm, confident"}] ${line.text}`, model_id: "eleven_v3", voice_settings: { stability: 0.5 } }),
    });
    if (!res.ok) { console.error(line.id, res.status, await res.text()); continue; }
    await writeFile(out, Buffer.from(await res.arrayBuffer()));
    console.log(`${name}/${line.id}-t${n}`);
  }
}
