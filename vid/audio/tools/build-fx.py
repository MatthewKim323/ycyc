#!/usr/bin/env python3
"""python3 audio/tools/build-fx.py [--no-master] [--comps DIR] [--out DIR]

Effects stem + full mix for the ycyc film (vid/). Ported from the Davey launch film (~/dev/nautshow1).

Only scene ids present in assets/timing.json are read (compositions/<id>.html); files that are
not mounted are ignored. Cue comments (t is scene-local seconds, accepts 1.2, 1.2s or 36f; one comment may
hold several cues split by ';'):

  <!-- sfx: t=1.23 name=text-tick gain=0.2 pan=0 -->
      a one-shot from assets/sfx/. Optional: pitch=<semis> (fixed), vary=0 (no jitter), len=<s>,
      fade=<s>, every=<s> until=<t> (repeat). name=type-micro becomes thocky keystrokes, one per character of
      the caller line typing at that moment (chars=<n> to force a count). name=room-* or callcenter-bed
      replaces that scene's room bed.
  <!-- crowd: t=1.20 pan=-0.6 [gain=0.8|-3db] [reply=1|0] -->
      a caller line from audio/crowd/crowd-NN.mp3 (24 voices, cycled so neighbours never share a voice),
      phone band + a little room. Every 3rd one (or reply=1) gets a short reply fragment (from lines whose who is in REPLY_FROM) after it.
  <!-- duck: t=2.10 len=0.4 -->
      suck-out: the whole fx stem (beds, crowd, cues) drops 10 dB over 0.25s from t, holds until t+len, comes
      back over 0.1s. Put the reveal at t+len. Max 4 per film.
  <!-- fade-crowd: t=4.0 len=1.0 -->
      every crowd layer playing at t fades to silence by t+len.

Layers: air bed under the whole film (never silent), a room bed per scene (ROOMS), callcenter-bed rising
under v-wall, authored cues, crowd (v-dash / v-wall get a fallback crowd if they author none). The stem
ducks under every voiced line (DUCK_BY), gets LIFT_DB from LIFT_FROM on (second-act lift, off by default),
lays the music bed (MUSIC) if present, and ends by subtraction: the air crossfades into a soft pad through the
last scene, no final hit unless authored.

Writes fx.wav (pre-master, balanced against dialogue.wav as mounted in index.html), mix.wav (dialogue + fx,
mastered to -14 LUFS, <= -1 dBTP) to assets/audio/, and SOUND.md.
"""
import hashlib
import json
import math
import random
import re
import subprocess
import sys
import tempfile
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
L = ROOT
SFX = L / "assets" / "sfx"
AUD = L / "assets" / "audio"
CROWD_DIR = ROOT / "audio" / "crowd"
DIALOGUE = AUD / "dialogue.wav"
SR = 48000
FPS = 30


def arg(flag, default):
    return Path(sys.argv[sys.argv.index(flag) + 1]) if flag in sys.argv else default


COMPS = arg("--comps", L / "compositions")
OUT = arg("--out", AUD)
DOC = (OUT / "SOUND.md") if "--out" in sys.argv else (L / "SOUND.md")
OUT.mkdir(parents=True, exist_ok=True)

timing = json.loads((L / "assets" / "timing.json").read_text())
SCENES = timing["scenes"]
S = {k: v["start"] for k, v in SCENES.items()}
D = {k: v["duration"] for k, v in SCENES.items()}
ORDER = sorted(SCENES, key=lambda k: S[k])
TOTAL = timing["total"]
LINES = timing["lines"]
# who -> dB the whole fx stem ducks under that speaker's lines. Speakers not listed (captions only) don't duck.
DUCK_BY = {"narrator": 3.0, "assistant": 5.0, "user": 4.0}
CROWD_UNDER_DB = 4.0                             # crowd voices + walla duck this much more under any voice line
VOICED = [l for l in LINES if l.get("who") in DUCK_BY]
REPLY_FROM = {"assistant"}                       # crowd reply fragments are cut from these speakers' lines
DAVEY = [l for l in LINES if l.get("who") in REPLY_FROM]

# Peak level (dBFS, pre-master) a sound reaches at the loudest gain its author used. Dialogue peaks
# around -4.5 dBFS / -19 LUFS, so these sit 8 to 26 dB under the voice per the reference recipes.
CAP_DB = {
    "text-tick": -27, "type-micro": -30, "thock": -18, "scramble-flurry": -23, "counter-grain": -27, "row-tick": -23,
    "ui-roll": -24, "case-pop": -17, "ui-confirm": -15, "ui-open": -21, "msg-sent": -17, "msg-in": -16,
    "card-morph": -19, "whoosh-soft": -17, "iris-close": -17, "mask-open": -19, "logo-bloom": -15,
    "wall-riser": -13, "endcard-hit": -9, "ding-success": -13, "slam-impact": -7, "final-hit": -5, "riser-tight": -13, "flash-tick": -19, "brand-shimmer": -21, "phone-ring": -19, "phone-buzz": -21, "callcenter-bed": -24,
    "digit-tick": -19, "whip": -12, "low-hit": -6,
}
CAP_DEFAULT = -20
CUE_TRIM_DB = 2.0
# Big sounds scale by the author's gain against at least this reference, so a lone gain=0.3 hit is not at cap.
BIG, BIG_REF = {"endcard-hit", "wall-riser", "logo-bloom", "slam-impact", "final-hit", "riser-tight"}, 0.6
JITTER = {"text-tick": 2, "type-micro": 2, "row-tick": 1.5, "case-pop": 1, "scramble-flurry": 1,
          "counter-grain": 0.7, "ui-confirm": 0.7, "msg-sent": 0.5, "msg-in": 0.5, "card-morph": 0.7,
          "whoosh-soft": 0.7, "phone-buzz": 0.3, "digit-tick": 0.7, "whip": 0.5}
# Room bed per scene: (sound, RMS dBFS). Scenes not listed get the air bed only.
# e.g. ROOMS = {"v-gym": ("room-morning", -55)}. A scene can also author <!-- sfx: name=room-... --> to set its own.
ROOMS = {}
ROOM_LEAD = 0.25
AIR_RMS_DB = -57
PAD_RMS_DB = -56
WALL_BED = (None, -32, -20)              # (scene id, from, to): a callcenter walla rising across one scene; None = off
EXTRA_CROWD = {}                        # {scene: n} extra voices on top of a scene's authored crowd cues, accelerating
LIFT_FROM, LIFT_DB = None, 2.5          # scene id where the second-act fx lift starts; None = off
SUCK_DB, SUCK_IN, SUCK_OUT, SUCK_MAX = 10.0, 0.25, 0.1, 4
DUCK_ATTACK, DUCK_RELEASE = 0.12, 0.3
END_FADE = 0.5
CROWD_LUFS = -23                         # one caller, integrated loudness after the phone band
CROWD_DENSITY_DB = 1.0                   # pulled down per doubling of voices already playing
REPLY_DB = -3                            # reply fragment relative to its caller
REPLY_EVERY = 3
FALLBACK_CROWD = {}                     # {scene: n} crowd voices for scenes that author none
PHONE = ("highpass=f=300,highpass=f=300,lowpass=f=3400,lowpass=f=3400,equalizer=f=1700:t=q:w=1.2:g=3,"
         "aecho=0.85:0.6:19|37:0.16|0.09")


def warn(msg):
    print(f"  ! {msg}", file=sys.stderr)


# ---------- source analysis ----------
_info = {}


def decode(path):
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"]
    a = array("h")
    a.frombytes(subprocess.run(cmd, check=True, capture_output=True).stdout)
    return a


def info(path):
    """peak (linear), onset s (first sample over peak -20 dB), loudest 50 ms window s, rms dB, duration."""
    if path in _info:
        return _info[path]
    a = decode(path)
    n = len(a)
    peak = max((abs(x) for x in a), default=1) / 32768 or 1e-6
    thr = peak * 32768 * 0.1
    onset = next((i for i, x in enumerate(a) if abs(x) > thr), 0) / SR
    w = SR // 20
    best, best_i = -1.0, 0
    for i in range(0, max(1, n - w), w // 2):
        e = sum(x * x for x in a[i:i + w:4])
        if e > best:
            best, best_i = e, i
    rms = math.sqrt(sum(x * x for x in a[::8]) / max(1, len(a[::8]))) / 32768
    _info[path] = dict(peak=peak, onset=onset, loudest=(best_i + w / 2) / SR,
                       rms_db=20 * math.log10(max(rms, 1e-7)), dur=n / SR)
    return _info[path]


_lufs = {}


def filtered_lufs(path, start=None, dur=None, af=None):
    """integrated loudness of a file (or a slice of it) after a filter chain."""
    key = (str(path), start, dur, af)
    if key not in _lufs:
        pre = ["-ss", f"{start:.3f}", "-t", f"{dur:.3f}"] if start is not None else []
        out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", *pre, "-i", str(path), "-af",
                              (af + "," if af else "") + "ebur128", "-f", "null", "-"],
                             capture_output=True, text=True).stderr
        m = re.findall(r"\bI:\s+(-?[\d.]+|-inf) LUFS", out)
        v = float(m[-1]) if m and m[-1] != "-inf" else -70.0
        _lufs[key] = v if v > -69 else -30.0
    return _lufs[key]


def db(x):
    return 10 ** (x / 20)


def rng_for(*key):
    return random.Random(int(hashlib.md5(repr(key).encode()).hexdigest()[:8], 16))


# ---------- cues from scene files ----------
CUE_RE = re.compile(r"<!--\s*(fade-crowd|crowd|duck|sfx)\s*:(.*?)-->", re.S)
KV_RE = re.compile(r"([a-zA-Z_]+)\s*=\s*([^\s;]+)")


def num(v):
    v = v.strip().rstrip(",").strip("\"'")
    m = re.fullmatch(r"([-+]?\d*\.?\d+)\s*(db|dB|f|s|ms)?", v)
    if not m:
        raise ValueError(v)
    x, u = float(m.group(1)), (m.group(2) or "").lower()
    return db(x) if u == "db" else x / FPS if u == "f" else x / 1000 if u == "ms" else x


cues, crowd_cues, ducks, crowd_fades, problems, room_override = [], [], [], [], [], {}
for sid in ORDER:
    f = COMPS / f"{sid}.html"
    if not f.exists():
        problems.append(f"{sid}: no compositions/{sid}.html")
        continue
    src_txt = f.read_text(errors="replace")
    for m in CUE_RE.finditer(src_txt):
        kind = m.group(1)
        for part in m.group(2).split(";"):
            kv = {k.lower(): v for k, v in KV_RE.findall(part)}
            if not kv:
                continue
            try:
                if kind != "sfx" and "t" not in kv:
                    raise ValueError("missing t")
                t = num(kv.get("t", "0"))
                pan = max(-1.0, min(1.0, num(kv["pan"]))) if "pan" in kv else None
                if not -1.0 <= t <= D[sid] + 1.0:
                    problems.append(f"{sid}: {kind} at t={t:.2f} is outside the scene ({D[sid]:.2f}s), placed anyway")
                if kind == "duck":
                    ln = max(0.05, min(2.0, num(kv.get("len", "0.4"))))
                    ducks.append(dict(scene=sid, t=t, len=ln, at=S[sid] + t))
                    continue
                if kind == "fade-crowd":
                    ln = max(0.05, num(kv.get("len", "1.0")))
                    crowd_fades.append(dict(scene=sid, t=t, len=ln, at=S[sid] + t))
                    continue
                if kind == "crowd":
                    reply = kv.get("reply")
                    crowd_cues.append(dict(scene=sid, t=t, at=S[sid] + t, pan=pan, gain=num(kv.get("gain", "1")),
                                           reply=None if reply is None else reply not in ("0", "false", "no")))
                    continue
                name = kv.get("name", "").removesuffix(".mp3").strip("\"'")
                c = dict(scene=sid, name=name, t=t, gain=num(kv.get("gain", "0.5")), pan=pan or 0.0,
                         pitch=num(kv["pitch"]) if "pitch" in kv else None, vary=kv.get("vary", "1") != "0",
                         len=num(kv["len"]) if "len" in kv else None, fade=num(kv["fade"]) if "fade" in kv else None,
                         chars=int(num(kv["chars"])) if "chars" in kv else None, cps=num(kv.get("cps", "30")))
            except (ValueError, KeyError) as e:
                problems.append(f"{sid}: unparseable {kind} cue '{part.strip()[:60]}' ({e})")
                continue
            if name.startswith("room-") or name == "callcenter-bed":
                if (SFX / f"{name}.mp3").exists():
                    room_override[sid] = name
                    continue
            if not name or not (SFX / f"{name}.mp3").exists():
                problems.append(f"{sid}: unknown sound '{name}' at t={kv.get('t')}")
                continue
            until = kv.get("until") or (re.search(r"through\s+([\d.]+)", part) or [None, None])[1]
            try:
                every = num(kv["every"]) if "every" in kv else (0.07 if until else None)
                until = num(until) if until else None
            except ValueError:
                every = until = None
                problems.append(f"{sid}: bad every/until on {name}")
            cues.append(c)
            if until and every and every > 0.02:
                r = rng_for(sid, c["t"], name, "rep")
                tt, n = c["t"] + every, 0
                while tt <= until + 1e-6 and n < 400:
                    cues.append({**c, "t": tt + r.uniform(-1, 1) / FPS, "gain": c["gain"] * db(r.uniform(-2, 0))})
                    tt, n = tt + every, n + 1
merged = []
for d in sorted(ducks, key=lambda d: d["at"]):
    if merged and d["at"] - merged[-1]["at"] < 0.8:
        problems.append(f"{d['scene']}: duck at t={d['t']:.2f} merged into the one at {merged[-1]['scene']} t={merged[-1]['t']:.2f}")
        merged[-1]["len"] = max(merged[-1]["len"], d["at"] + d["len"] - merged[-1]["at"])
        continue
    merged.append(d)
ducks = merged
if len(ducks) > SUCK_MAX:
    problems.append(f"{len(ducks)} duck cues, the reference says max {SUCK_MAX}: keeping the first {SUCK_MAX}")
    ducks = sorted(ducks, key=lambda d: d["at"])[:SUCK_MAX]
for p in problems:
    warn(p)
authored = {(c["scene"], c["name"]) for c in cues}
gref = {}
for c in cues:
    gref[c["name"]] = max(gref.get(c["name"], 0), min(c["gain"], 1.0))

# ---------- graph ----------
inputs, chains, labels, uses = [], [], [], {}
src_index = {}


def src(path, loop=False):
    key = (str(path), loop)
    if key not in src_index:
        inputs.extend((["-stream_loop", "-1"] if loop else []) + ["-i", str(path)])
        src_index[key] = sum(1 for x in inputs if x == "-i") - 1
        uses[src_index[key]] = []
    return src_index[key]


def layer(path, at, peak_db=None, rms_db=None, pan=0.0, offset=None, length=None, fade_in=0.004,
          fade_out=0.03, semis=0.0, loop=False, extra="", pre="", gain_db=None):
    """Place a sound so its (offset) point lands at film time `at`, at a target peak or RMS level.
    Returns (start, length) in film time, or None if nothing was placed."""
    i = src(path, loop)
    inf = info(path) if gain_db is None or offset is None else None
    if offset is None:
        offset = max(0.0, inf["onset"] - 0.004)
    if at < 0:
        offset -= at
        at = 0.0
    if gain_db is not None:
        g = db(gain_db)
    elif peak_db is not None:
        g = db(peak_db) / inf["peak"]
    else:
        g = db(rms_db - inf["rms_db"])
    avail = 1e9 if (loop or inf is None) else (inf["dur"] - offset)
    ln = min(length or avail, avail, TOTAL - at)
    if ln <= 0.01:
        return None
    r = 2 ** (semis / 12)
    f = [f"atrim=start={offset:.4f}:duration={ln * r:.4f}", "asetpts=PTS-STARTPTS", f"aresample={SR}",
         "aformat=sample_fmts=fltp:channel_layouts=stereo"]
    if pre:
        f.append(pre)
    if abs(semis) > 0.01:
        f += [f"asetrate={SR * r:.1f}", f"aresample={SR}", f"atempo={1 / r:.5f}"]
    if extra:
        f.append(extra)
    fo = min(fade_out, ln / 2)
    f += [f"afade=t=in:d={min(fade_in, ln / 2):.3f}", f"afade=t=out:st={max(0, ln - fo):.4f}:d={fo:.4f}",
          f"volume={g:.6f}"]
    if pan:
        lg, rg = min(1, 1 - pan), min(1, 1 + pan)
        f.append(f"pan=stereo|c0={lg:.3f}*c0|c1={rg:.3f}*c1")
    d = int(round(at * 1000))
    f.append(f"adelay={d}|{d}")
    k = len(labels)
    uses[i].append(k)
    chains.append((i, ",".join(f), k))
    labels.append(f"[l{k}]")
    return at, ln


def next_scene(sid):
    k = ORDER.index(sid)
    return ORDER[k + 1] if k + 1 < len(ORDER) else None


def crowd_duck(at, ln):
    """volume expression (layer-local t) that pulls a crowd layer CROWD_UNDER_DB further down under voice lines."""
    terms = [f"clip(min((t+{at:.3f}-{l['start'] - DUCK_ATTACK:.3f})/{DUCK_ATTACK},({l['end'] + DUCK_RELEASE:.3f}-t-{at:.3f})/{DUCK_RELEASE}),0,1)"
             for l in VOICED if l["start"] - DUCK_ATTACK < at + ln and l["end"] + DUCK_RELEASE > at]
    if not terms or not CROWD_UNDER_DB:
        return ""
    e = terms[0]
    for x in terms[1:]:
        e = f"max({e},{x})"
    return f"volume=eval=frame:volume='pow(10,-{CROWD_UNDER_DB}*{e}/20)'"


# room beds (looped), each leading its picture and crossfading out past the cut
rooms = {sid: (room_override.get(sid, name), lvl) for sid, (name, lvl) in ROOMS.items() if sid in S}
for sid, name in room_override.items():
    rooms.setdefault(sid, (name, -53))
for sid, (name, lvl) in rooms.items():
    if name == "callcenter-bed":
        continue
    st = max(0, S[sid] - ROOM_LEAD)
    layer(SFX / f"{name}.mp3", st, rms_db=lvl, offset=rng_for(sid).uniform(0, 3), length=D[sid] + ROOM_LEAD + 0.3,
          fade_in=ROOM_LEAD if st else 0.3, fade_out=0.35, loop=True)

# the wall: callcenter-bed rising across v-wall (or wherever a scene names it), out 0.6s into the next scene
bed_scenes = {sid for sid, (n, _) in rooms.items() if n == "callcenter-bed"}
if WALL_BED[0] in S:
    bed_scenes.add(WALL_BED[0])
for sid in sorted(bed_scenes, key=lambda k: S[k]):
    lo, hi = (WALL_BED[1], WALL_BED[2]) if sid == WALL_BED[0] else (-42, -38)
    st = max(0, S[sid] - 0.5)
    nxt = next_scene(sid)
    end = (S[nxt] + 0.6) if nxt else TOTAL
    ln, fo = end - st, 0.8
    for fc in crowd_fades:          # a fade-crowd takes the bed out with the voices
        if st < fc["at"] + fc["len"] <= st + ln:
            ln, fo = fc["at"] + fc["len"] - st, fc["len"]
            break
    p = SFX / ("callcenter-hectic.mp3" if sid == WALL_BED[0] and (SFX / "callcenter-hectic.mp3").exists() else "callcenter-bed.mp3")
    rise = f"volume=eval=frame:volume='pow(10,{hi - lo:.1f}*clip((t-0.5)/{max(0.5, D[sid] - 0.6):.3f},0,1)/20)'"
    layer(p, st, rms_db=lo, offset=2.0, length=ln, fade_in=0.9, fade_out=fo, loop=True, extra=",".join(x for x in (rise, crowd_duck(st, ln)) if x))

# Typing: each type-micro cue becomes a burst of thocky keystrokes, one per character of the caller
# text that types at that moment, at the on-screen rate (cps=, default 30 = KIT.smear).
THOCKS = [SFX / f"thock-{i}.mp3" for i in range(1, 5)]


def typing_burst(c):
    sid = c["scene"]
    if not THOCKS[0].exists():
        return False
    if c["chars"]:
        text = "x" * max(1, min(c["chars"], 120))
    else:
        line = min((l for l in LINES if l["scene"] == sid and l.get("who") not in DUCK_BY),
                   key=lambda l: abs((l["start"] - S[sid]) - c["t"]), default=None)
        if not line:
            return False
        text = " ".join(line["text"]) if isinstance(line["text"], list) else str(line["text"])
    r = rng_for(sid, round(c["t"], 3), "thock")
    last = -1
    for k, ch in enumerate(text):
        if ch in ".,?!'\"":
            continue
        t = S[sid] + c["t"] + k / c["cps"] + r.uniform(-0.006, 0.006)
        if ch == " ":
            path = SFX / "thock-space.mp3"
        else:
            i = r.choice([j for j in range(4) if j != last]); last = i
            path = THOCKS[i]
        lvl = CUE_TRIM_DB + CAP_DB["thock"] + r.uniform(-2.0, 0.5) - (1.5 if ch == " " else 0)
        layer(path, t, peak_db=lvl, pan=c["pan"], length=0.35, fade_out=0.05, semis=r.uniform(-0.6, 0.6))
    return True


for c in cues:
    sid, name = c["scene"], c["name"]
    if name == "type-micro" and typing_burst(c):
        continue
    r = rng_for(sid, round(c["t"], 3), name)
    semis = c["pitch"] if c["pitch"] is not None else (r.uniform(-1, 1) * JITTER.get(name, 0) if c["vary"] else 0)
    gj = r.uniform(-1.5, 1.5) if c["vary"] and name in JITTER else 0
    ref = max(gref[name], BIG_REF) if name in BIG else gref[name]
    lvl = CUE_TRIM_DB + CAP_DB.get(name, CAP_DEFAULT) + 20 * math.log10(max(min(c["gain"], 1.0), 1e-4) / ref) + gj
    at, ln, fo = S[sid] + c["t"], c["len"], c["fade"] or 0.03
    if name in BIG and not c["len"]:
        # a big tail never rides over the next voice line: it is gone 0.5s into it
        nxt = min((l["start"] for l in VOICED if at + 0.25 < l["start"] < at + info(SFX / f"{name}.mp3")["dur"]), default=None)
        if nxt is not None:
            ln, fo = nxt + 0.5 - at, max(fo, min(0.7, nxt + 0.5 - at - 0.1))
    layer(SFX / f"{name}.mp3", at, peak_db=lvl, pan=c["pan"], length=ln, fade_out=fo, semis=semis)

# ---------- music ----------
# One bed under the film: assets/music/bed.mp3 (any track), starting at film time MUSIC_AT from song time
# MUSIC_OFFSET (set it so a drop lands on a cut), at MUSIC_RMS dBFS RMS. It rides the fx stem's voice ducking.
MUSIC = L / "assets" / "music" / "bed.mp3"   # the Skarl demo track (~/dev/skarl-promo/assets/music/demomusic.mp3), ~87.6 BPM
MUSIC_AT, MUSIC_OFFSET, MUSIC_RMS = 0.0, 0.0, -22.0
# Lock the song's first drop (11.04 s in) to the ycyc mark landing in s03-reveal (scene-local 1.2 s): the cold open
# stays sparse and the beat hits on the brand.
MUSIC_DROP, DROP_SCENE, DROP_LOCAL = 11.04, "s03-reveal", 1.2
if DROP_SCENE in S:
    at = S[DROP_SCENE] + DROP_LOCAL - MUSIC_DROP
    MUSIC_AT, MUSIC_OFFSET = (at, 0.0) if at >= 0 else (0.0, -at)
if MUSIC.exists():
    layer(MUSIC, MUSIC_AT, rms_db=MUSIC_RMS, offset=MUSIC_OFFSET, length=TOTAL - MUSIC_AT, fade_in=0.4, fade_out=1.4)

# ---------- crowd ----------
CROWD = sorted(CROWD_DIR.glob("crowd-*.mp3")) if CROWD_DIR.exists() else []
if not CROWD and (crowd_cues or FALLBACK_CROWD):
    warn("no audio/crowd/crowd-*.mp3: crowd cues skipped")
# fallback crowd for scenes that should have one but author none (denser as the scene goes on)
auto_crowd = []
for sid, n in FALLBACK_CROWD.items():
    if sid in S and not any(c["scene"] == sid for c in crowd_cues):
        r = random.Random(f"crowd-{sid}")
        for k in range(n):
            x = (k + 0.5) / n
            t = 0.15 + D[sid] * 0.9 * x ** 0.7 + r.uniform(-0.08, 0.08)
            auto_crowd.append(dict(scene=sid, t=t, at=S[sid] + t, pan=r.uniform(-0.9, 0.9) * (1 if k % 2 else -1),
                                   gain=db(-6 + 6 * x) if sid == "v-wall" else db(-3), reply=None, auto=True))
for sid, n in EXTRA_CROWD.items():
    if sid in S:
        r = random.Random(f"extra-{sid}")
        for k in range(n):
            x = (k + 0.5) / n
            t = 0.1 + 3.8 * x ** 0.8 + r.uniform(-0.05, 0.05)
            auto_crowd.append(dict(scene=sid, t=t, at=S[sid] + t, pan=r.uniform(-1, 1), gain=db(-7 + 5 * x),
                                   reply=False, auto=True))
all_crowd = sorted(crowd_cues + auto_crowd, key=lambda c: c["at"])
# a fixed shuffle of the 24 voices, cycled in film order: neighbours never repeat a voice
perm = list(range(len(CROWD)))
random.Random(24).shuffle(perm)
replies = []
for l in DAVEY:
    ln = l["end"] - l["start"]
    if ln > 0.4:
        replies.append((l["start"] - 0.02, min(ln, 1.05)))
crowd_spans = []


def fade_for(at, ln):
    """shorten a crowd layer so it is gone by the end of any fade-crowd that catches it."""
    for fc in sorted(crowd_fades, key=lambda x: x["at"]):
        a, b = fc["at"], fc["at"] + fc["len"]
        if at >= b or at + ln <= a:
            continue
        return max(0.02, b - at), max(0.02, min(fc["len"], b - at))
    return ln, None


for k, c in enumerate(all_crowd):
    if not CROWD:
        break
    path = CROWD[perm[k % len(CROWD)]]
    inf = info(path)
    ln = inf["dur"] - max(0.0, inf["onset"] - 0.004)
    # density: each concurrent voice already playing pulls this one down a little so a pile-up is a roar, not a clip
    busy = sum(1 for a, b in crowd_spans if a <= c["at"] < b)
    lvl = CROWD_LUFS + 20 * math.log10(max(min(c["gain"], 2.0), 1e-3)) - CROWD_DENSITY_DB * math.log2(1 + busy)
    pan = c["pan"] if c["pan"] is not None else rng_for("cpan", k).uniform(-0.8, 0.8)
    ln, fo = fade_for(c["at"], ln)
    got = layer(path, c["at"], gain_db=lvl - filtered_lufs(path, af=PHONE), pan=pan, length=ln, fade_in=0.02, fade_out=fo or 0.12, pre=PHONE,
                extra=crowd_duck(c["at"], ln))
    if not got:
        continue
    crowd_spans.append((got[0], got[0] + got[1]))
    c["voice"] = path.stem
    want = c["reply"] if c["reply"] is not None else (k % REPLY_EVERY == REPLY_EVERY - 1)
    if want and replies and fo is None:
        off, rl = replies[k % len(replies)]
        at = got[0] + got[1] + 0.12
        rl, rfo = fade_for(at, rl)
        g = lvl + REPLY_DB - filtered_lufs(DIALOGUE, off, rl, PHONE)
        if layer(DIALOGUE, at, gain_db=g, pan=pan * 0.7, offset=off, length=rl,
                 fade_in=0.02, fade_out=rfo or 0.18, pre=PHONE, extra=crowd_duck(at, rl)):
            crowd_spans.append((at, at + rl))
            c["reply_used"] = True

# ---------- stem envelope: voice ducking, suck-outs, second-act lift ----------
def clip01(x):
    return f"clip({x},0,1)"


vterms = [f"{DUCK_BY[l['who']]:.1f}*clip(min((t-{l['start'] - DUCK_ATTACK:.3f})/{DUCK_ATTACK},"
          f"({l['end'] + DUCK_RELEASE:.3f}-t)/{DUCK_RELEASE}),0,1)" for l in VOICED]
vduck = vterms[0] if vterms else "0"
for term in vterms[1:]:
    vduck = f"max({vduck},{term})"
sterms = []
for d in ducks:
    a, r, h = d["at"], min(SUCK_IN, d["len"]), d["at"] + d["len"]
    sterms.append(f"if(lt(t,{a:.3f}),0,if(lt(t,{a + r:.3f}),pow((t-{a:.3f})/{r:.3f},2),"
                  f"clip(1-(t-{h:.3f})/{SUCK_OUT},0,1)))")
suck = "+".join(sterms) if sterms else "0"
lift_at = S.get(LIFT_FROM)
lift = f"{LIFT_DB}*clip((t-{lift_at:.3f})/0.08,0,1)" if lift_at is not None else "0"
env = f"pow(10,({lift}-({vduck})-{SUCK_DB}*min(1,{suck}))/20)"
bed_back = f"pow(10,{SUCK_DB / 2}*min(1,{suck})/20)"   # air/pad only lose half the suck-out

graph = []
for i, ks in uses.items():
    if not ks:
        continue
    outs = "".join(f"[s{k}]" for k in ks)
    graph.append(f"[{i}:a]asplit={len(ks)}{outs}" if len(ks) > 1 else f"[{i}:a]anull[s{ks[0]}]")
for i, fl, k in chains:
    graph.append(f"[s{k}]{fl}[l{k}]")
# air under everything; through the last scene it crossfades into a darker, slowly breathing pad
last = ORDER[-1]
p0 = S[last] - 0.4
graph.append(f"anoisesrc=r={SR}:color=pink:amplitude=1:seed=7:d={TOTAL:.3f},highpass=f=90,lowpass=f=4800,"
             f"volume={db(AIR_RMS_DB + 16):.6f},volume=eval=frame:volume='(1-clip((t-{p0:.3f})/1.2,0,1))*{bed_back}',"
             f"aformat=sample_fmts=fltp:channel_layouts=stereo[air]")
graph.append(f"anoisesrc=r={SR}:color=brown:amplitude=1:seed=11:d={TOTAL:.3f},highpass=f=110,lowpass=f=900,"
             f"lowpass=f=900,tremolo=f=0.18:d=0.35,volume={db(PAD_RMS_DB + 16):.6f},"
             f"volume=eval=frame:volume='clip((t-{p0:.3f})/1.2,0,1)*{bed_back}',"
             f"aformat=sample_fmts=fltp:channel_layouts=stereo[pad]")
if not labels:
    graph.append(f"anullsrc=r={SR}:cl=stereo:d={TOTAL:.3f}[l0]")
    labels.append("[l0]")
graph.append(f"[air][pad]{''.join(labels)}amix=inputs={len(labels) + 2}:normalize=0:duration=longest,"
             f"asetnsamples=n=240,volume=eval=frame:volume='{env}',"
             f"afade=t=out:st={TOTAL - END_FADE:.3f}:d={END_FADE},alimiter=limit=0.7:level=false,"
             f"apad=whole_dur={TOTAL:.3f},atrim=0:{TOTAL:.3f}[out]")
fx = OUT / "fx.wav"
script = Path(tempfile.mkstemp(suffix=".ffgraph")[1])
script.write_text(";\n".join(graph))
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-/filter_complex", str(script), "-map", "[out]",
                "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s16le", str(fx)], check=True)
script.unlink()
n_crowd = sum(1 for c in all_crowd if "voice" in c)
n_reply = sum(1 for c in all_crowd if c.get("reply_used"))
print(f"fx.wav: {len(labels)} layers ({len(cues)} sfx, {n_crowd} crowd + {n_reply} replies, {len(ducks)} ducks, "
      f"{len(crowd_fades)} crowd fades) from {len(uses)} sources")


# ---------- master ----------
def ebur(path, start=None, dur=None, windows=None):
    pre = ["-ss", f"{start:.3f}", "-t", f"{dur:.3f}"] if start is not None else []
    af = "ebur128=peak=true"
    if windows:
        sel = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in windows)
        af = f"aselect='{sel}',asetpts=N/SR/TB," + af
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", *pre, "-i", str(path), "-af", af,
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    s = out[out.rfind("Summary:"):]
    g = lambda k: float((re.search(rf"{k}:\s+(-?[\d.]+|-inf)", s) or [0, "-120"])[1].replace("-inf", "-120"))
    return dict(I=g("I"), LRA=g("LRA"), TP=g("Peak"))


mix = OUT / "mix.wav"
PRE = "amix=inputs=2:normalize=0,acompressor=threshold=0.06:ratio=3:attack=10:release=220:knee=6"
if "--no-master" not in sys.argv:
    gain = 0.0
    for _ in range(4):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(DIALOGUE), "-i", str(fx), "-filter_complex",
                        f"{PRE},volume={gain:.2f}dB,alimiter=limit={db(-2.1):.4f}:attack=2:release=60:level=false:asc=1",
                        "-ar", str(SR), "-c:a", "pcm_s16le", str(mix)], check=True)
        m = ebur(mix)
        if abs(m["I"] + 14) < 0.25 and m["TP"] <= -1.0:
            break
        gain += -14 - m["I"]
    print(f"mix.wav: I {m['I']:.1f} LUFS, TP {m['TP']:.1f} dBTP, LRA {m['LRA']:.1f} LU (master gain {gain:+.1f} dB)")

    # ---------- report ----------
    def silent_spans(path):
        out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af",
                              "silencedetect=n=-50dB:d=0.2", "-f", "null", "-"], capture_output=True, text=True).stderr
        return re.findall(r"silence_start: ([\d.]+)", out)

    def bed_name(sid):
        n = rooms.get(sid, ("air", 0))[0]
        n = "callcenter-bed (rising)" if sid in bed_scenes else n
        if sid == last:
            n = "air -> pad"
        if any(c["scene"] == sid and "voice" in c for c in all_crowd):
            auto = any(c["scene"] == sid and c.get("auto") for c in all_crowd)
            n += " + crowd" + (" (auto)" if auto else "")
        return n

    rows = []
    for sid in ORDER:
        a, f = ebur(mix, S[sid], D[sid]), ebur(fx, S[sid], D[sid])
        win = [(l["start"], l["end"]) for l in VOICED if l["scene"] == sid]
        b = ebur(DIALOGUE, windows=win) if win else {"I": -70}
        fv = ebur(fx, windows=win) if win else None
        n = sum(1 for c in cues if c["scene"] == sid)
        nc = sum(1 for c in all_crowd if c["scene"] == sid and "voice" in c)
        nd = sum(1 for d in ducks if d["scene"] == sid)
        voice = f"{b['I']:.1f}" if b["I"] > -69 else "none"
        gap = f"{b['I'] - fv['I']:.1f}" if fv else ""
        lifted = "+%.1f" % LIFT_DB if lift_at is not None and S[sid] >= lift_at else ""
        rows.append(f"| {sid} | {S[sid]:.2f} | {n} | {nc} | {nd} | {bed_name(sid)} | {lifted} | {a['I']:.1f} | "
                    f"{a['TP']:.1f} | {voice} | {f['I']:.1f} | {gap} |")
    sil = silent_spans(mix)
    per = {}
    for c in cues:
        per.setdefault(c["scene"], []).append(f"{c['t']:.2f} {c['name']}")
    for c in all_crowd:
        if "voice" in c:
            per.setdefault(c["scene"], []).append(f"{c['t']:.2f} crowd {c['voice'][-2:]}{'+davey' if c.get('reply_used') else ''}"
                                                  f"{' (auto)' if c.get('auto') else ''}")
    for d in ducks:
        per.setdefault(d["scene"], []).append(f"{d['t']:.2f} duck {d['len']:.2f}s")
    for d in crowd_fades:
        per.setdefault(d["scene"], []).append(f"{d['t']:.2f} fade-crowd {d['len']:.2f}s")
    sheet = "\n".join(f"- **{sid}**: " + ", ".join(sorted(per[sid], key=lambda x: float(x.split()[0])))
                      for sid in ORDER if sid in per) or "- (no authored cues yet)"
    DOC.write_text(f"""# Sound

Built by `python3 audio/tools/build-fx.py` from the cue comments in `compositions/<scene>.html` (only the
scenes in `assets/timing.json`) and `assets/timing.json`. Re-run it after any scene or timing change, then
`python3 tools/mount.py`.

- `assets/audio/fx.wav`: effects stem, pre-master, balanced against `dialogue.wav` (what index.html plays).
- `assets/audio/mix.wav`: dialogue + fx, mastered (compressor, {gain:+.1f} dB, limiter at -2.1 dBFS). Use it for the final render.

## Cues (scene-local seconds; 1.2, 1.2s or 36f)

- `<!-- sfx: t=1.23 name=text-tick gain=0.2 pan=0 -->` one-shot from `assets/sfx/`. Optional `pitch=`, `vary=0`, `len=`, `fade=`, `every= until=`. `name=type-micro` types thocky keys for the caller line at that moment (`chars=N` to force, `cps=` the on-screen rate, default 30). `name=room-*` / `callcenter-bed` swaps the scene's bed.
- `<!-- crowd: t=1.20 pan=-0.6 gain=0.8 reply=1 -->` one caller (24 voices, cycled, neighbours never repeat), phone band 300 to 3400 Hz + a little room. Every {REPLY_EVERY}rd gets a short phone-band reply unless `reply=0`; `reply=1` forces one.
- `<!-- duck: t=2.10 len=0.4 -->` suck-out: cues, crowd and rooms -{SUCK_DB:.0f} dB (air -{SUCK_DB / 2:.0f} so it never goes silent) over {SUCK_IN}s from t, hold to t+len, back over {SUCK_OUT}s. Land the reveal at t+len. Max {SUCK_MAX}.
- `<!-- fade-crowd: t=4.0 len=1.0 -->` every crowd voice playing at t (and the callcenter-bed) is gone by t+len.

## Master

Integrated **{m['I']:.1f} LUFS**, true peak **{m['TP']:.1f} dBTP**, LRA **{m['LRA']:.1f} LU**.
Spans under -50 dBFS for 0.2s+: {len(sil)} {('(at ' + ', '.join(sil[:6]) + ')') if sil else '(never silent)'}.

## Per scene

Mix columns are the mastered mix (LUFS / dBTP). Voice and fx are the pre-master stems; "voice I" is every voiced line, "under" is how far the fx sit below them while they talk (after ducking). "lift" is the second-act fx lift.

| scene | start | sfx | crowd | ducks | bed | lift | mix I | mix TP | voice I | fx I | under |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
{chr(10).join(rows)}

## Layers

- Air bed (pink noise 90 Hz to 6.5 kHz, {AIR_RMS_DB} dBFS RMS) under everything; through {last} it crossfades into a soft brown-noise pad ({PAD_RMS_DB} dBFS RMS, 110 to 900 Hz, slow breathing). Ending by subtraction, no hit unless a scene authors `endcard-hit`. {END_FADE}s fade at the very end.
- Rooms ({ROOM_LEAD}s lead, crossfade past the cut): {', '.join(f'{k} {v[0]} {v[1]}' for k, v in rooms.items() if v[0] != 'callcenter-bed')} dBFS RMS. Other scenes: air only.
- {WALL_BED[0]}: callcenter-bed from 0.5s before, rising {WALL_BED[1]} to {WALL_BED[2]} dBFS RMS, out 0.6s into the next scene.
- Crowd: one caller at {CROWD_LUFS} LUFS after the phone band, -{CROWD_DENSITY_DB} dB per doubling of voices already playing so a pile-up roars under the narrator; replies {REPLY_DB} dB under their caller. Scenes with no crowd cues get a fallback crowd: {', '.join(f'{k} x{v}' for k, v in FALLBACK_CROWD.items())}.
- One-shots: onset-aligned, peak-normalized, capped per sound (text-tick -27, digit-tick -19, type-micro -30, pops -17, clicks -15, whooshes -17, whip -12, endcard-hit -9, low-hit -6, slam-impact -7, final-hit -5 dBFS peak), the author's gain scales down from the cap relative to its loudest use (endcard-hit, wall-riser, logo-bloom: relative to at least 0.6, and their tails clear out 0.5s into the next voice line). Repeats jitter up to +-2 semitones and +-1.5 dB.
- Sources: the sfx library carried over from the Davey film (Mixkit free-license previews + ElevenLabs generations, processed in ~/dev/nautshow1/audio/tools/process-sfx.py). New sounds: `node audio/tools/gen-sfx.mjs` from `audio/sfx.json`.
- Crowd voices, phone replies and the wall walla duck another {CROWD_UNDER_DB:.0f} dB under any voice line, so the narrator stays on top of the wall.
- Whole stem ducks under voiced lines ({', '.join(f'{k} {v:.0f} dB' for k, v in DUCK_BY.items())}; {DUCK_ATTACK}s in, {DUCK_RELEASE}s out). Lift: {('+' + str(LIFT_DB) + ' dB from ' + LIFT_FROM) if LIFT_FROM else 'off'}.
- Music: {('`' + MUSIC.name + '` at ' + str(MUSIC_RMS) + ' dBFS RMS from ' + str(MUSIC_AT) + 's (song offset ' + str(MUSIC_OFFSET) + 's), ducked with the stem') if MUSIC.exists() else 'none (drop a track at assets/music/bed.mp3)'}.

## Cue sheet (scene-local seconds)

{sheet}
{chr(10).join('- ! ' + p for p in problems)}
""")
    print(f"wrote {DOC}")
