#!/usr/bin/env python3
"""python3 audio/tools/build-dialogue.py

Reads audio/edl.json, cuts every line, lays the scenes end to end and writes:
  assets/audio/dialogue.wav   one stereo dialogue stem for the whole film
  assets/timing.json          scene starts/durations and every line's absolute start/end/text
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets"
TMP = ROOT / "audio" / ".cut"
RATE = 48000


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


TEMPO = {}  # who -> default atempo for that speaker (a line can set its own "tempo")


def cut(line, index):
    """One line as a 48 kHz stereo wav: Davey cut by in/out, callers trimmed of edge silence."""
    dest = TMP / f"{index:03d}.wav"
    src = ROOT / line["src"]
    filters = []
    args = ["ffmpeg", "-v", "error", "-y"]
    if "in" in line:
        args += ["-ss", str(line["in"]), "-to", str(line["out"])]
    else:
        trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05"
        filters += [trim, "areverse", trim, "areverse"]
    # Squeeze any pause over 0.32s down to ~0.16s so the dialogue plays at a natural, tight pace.
    filters += ["silenceremove=stop_periods=-1:stop_duration=0.32:stop_threshold=-42dB:stop_silence=0.16"]
    tempo = line.get("tempo", TEMPO.get(line["who"], 1.0))
    if tempo != 1.0:
        filters += [f"atempo={tempo}"]
    if line.get("phone") == "light":
        # A little phone-call muffle that keeps the voice clear: rolled-off lows and highs, a touch of
        # midrange honk and line compression.
        filters += ["highpass=f=230", "lowpass=f=5200", "equalizer=f=1700:t=q:w=1.2:g=3.5",
                    "acompressor=threshold=-22dB:ratio=3:attack=4:release=90:makeup=2"]
    elif line.get("phone"):
        filters += ["highpass=f=320", "lowpass=f=3400"]
    filters += ["afade=t=in:d=0.012", "areverse", "afade=t=in:d=0.03", "areverse"]
    pan = line.get("pan", 0.0)
    gain = line.get("gain", 1.0)
    left, right = gain * min(1, 1 - pan), gain * min(1, 1 + pan)
    filters += [f"aresample={RATE}", f"pan=stereo|c0={left:.3f}*c0|c1={right:.3f}*c0"]
    args += ["-i", str(src), "-af", ",".join(filters), "-ac", "2", str(dest)]
    subprocess.run(args, check=True)
    return dest, duration(dest)


def main():
    # Optional: build-dialogue.py <edl.json> <out dir> (defaults: audio/edl.json -> assets).
    edl_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "audio" / "edl.json"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else OUT
    edl = json.loads(edl_path.read_text())
    TMP.mkdir(parents=True, exist_ok=True)
    (out / "audio").mkdir(parents=True, exist_ok=True)
    scenes, lines, placed = {}, [], []
    clock = 0.0
    index = 0
    for scene in edl["scenes"]:
        if scene.get("skip"):
            scenes[scene["id"]] = {"start": round(clock, 3), "duration": 0, "skip": True}
            continue
        start = clock
        cursor = 0.0
        last_end = 0.0
        ends = []
        for line in scene["lines"]:
            if line.get("silent"):  # text-only caller bubble: holds time for reading, no audio
                path, length = None, line["dur"]
            else:
                path, length = cut(line, index)
                index += 1
            if "after" in line:  # start right after another line in this scene (index), for overlapping calls
                at = ends[line["after"]] + line.get("gap", 0.1)
            else:
                at = line["at"] if "at" in line else cursor + line.get("gap", 0.25)
            begin, end = start + at, start + at + length
            if path:
                placed.append((path, begin))
            lines.append({"scene": scene["id"], "who": line["who"], "start": round(begin, 3), "end": round(end, 3),
                          "text": line["text"], **({"corner": line["corner"]} if "corner" in line else {})})
            cursor = at + length
            ends.append(cursor)
            last_end = max(last_end, cursor)
        length = max(scene["min"], last_end + scene["tail"])
        scenes[scene["id"]] = {"start": round(start, 3), "duration": round(length, 3)}
        clock += length
    # Mix every placed line onto one stem.
    inputs, chains = [], []
    for i, (path, begin) in enumerate(placed):
        inputs += ["-i", str(path)]
        delay = int(round(begin * 1000))
        chains.append(f"[{i}:a]adelay={delay}|{delay}[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(len(placed)))
    if placed:
        graph = ";".join(chains) + f";{mix}amix=inputs={len(placed)}:normalize=0,alimiter=limit=0.84:level=false,apad=whole_dur={clock:.3f}[out]"
        subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[out]",
                        "-ar", str(RATE), "-ac", "2", str(out / "audio" / "dialogue.wav")], check=True)
    else:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=stereo:d={max(clock, 0.1):.3f}",
                        "-ar", str(RATE), "-ac", "2", str(out / "audio" / "dialogue.wav")], check=True)
    (out / "timing.json").write_text(json.dumps({"total": round(clock, 3), "scenes": scenes, "lines": lines}, indent=2))
    for sid, s in scenes.items():
        print(f"{sid}: {s['start']:6.2f} +{s['duration']:5.2f}")
    print(f"total {clock:.2f}s, {len(lines)} lines")


main()
