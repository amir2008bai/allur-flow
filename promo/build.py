"""Монтаж промо-ролика Allur Flow из записи record.cjs: нарезка, ускорение, переходы, музыка и звуковые эффекты.

Запуск: python promo/build.py <папка записи> <папка результата>
В папке записи: raw.mp4 (кадры записи в 30 к/с) и events.json (время событий для звука).
Результат: allur-flow-promo.mp4 (1080p, звук), allur-flow-promo.gif (короткая версия без звука для README).
Музыка и эффекты синтезируются здесь же (numpy) — без чужих сэмплов и лицензий.
"""
from __future__ import annotations

import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
SR = 44100
XF = 0.32           # длительность перехода, с

# (начало, конец в записи, скорость, переход в этот кусок)
SEGMENTS = [
    (0.0, 2.6, 1.0, None),            # заставка
    (2.6, 12.9, 2.0, "smoothup"),     # 3D: пуск и облёт
    (14.9, 18.8, 1.35, "slideleft"),  # План
    (20.6, 24.1, 1.3, "slideleft"),   # Схема
    (27.4, 33.0, 1.5, "slideleft"),   # что если встанет сборка
    (34.6, 37.2, 1.0, "slideup"),     # эффект для завода
    (40.1, 41.6, 0.85, "slideleft"),  # брифинг (без кадров переключения вкладки)
    (44.6, 45.6, 0.7, "slideleft"),   # архитектура (после загрузки 3D)
    (45.6, 49.5, 1.0, "fadewhite"),   # финал
]


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def timeline():
    """Начало каждого куска в итоговом ролике (с учётом ускорения и наложения переходов)."""
    starts, t = [], 0.0
    for i, (a, b, sp, _) in enumerate(SEGMENTS):
        dur = (b - a) / sp
        starts.append(t)
        t += dur - (XF if i + 1 < len(SEGMENTS) else 0)
    total = starts[-1] + (SEGMENTS[-1][1] - SEGMENTS[-1][0]) / SEGMENTS[-1][2]
    return starts, total


def map_time(t_raw: float, starts) -> float | None:
    """Время события записи → время в ролике (None, если кусок вырезан)."""
    for (a, b, sp, _), s in zip(SEGMENTS, starts):
        if a <= t_raw <= b:
            return s + (t_raw - a) / sp
    return None


# ── Видео ────────────────────────────────────────────────────────────────────────────────────
def build_video(starts, total) -> Path:
    parts, fc = [], []
    for i, (a, b, sp, _) in enumerate(SEGMENTS):
        fc.append(f"[0:v]trim={a}:{b},setpts=(PTS-STARTPTS)/{sp},fps=30,scale=1920:1080:flags=lanczos,format=yuv420p,settb=1/30[s{i}]")
        parts.append(f"s{i}")
    cur, acc = parts[0], (SEGMENTS[0][1] - SEGMENTS[0][0]) / SEGMENTS[0][2]
    for i in range(1, len(SEGMENTS)):
        tr = SEGMENTS[i][3] or "fade"
        out = f"x{i}"
        fc.append(f"[{cur}][s{i}]xfade=transition={tr}:duration={XF}:offset={acc - XF:.3f}[{out}]")
        acc += (SEGMENTS[i][1] - SEGMENTS[i][0]) / SEGMENTS[i][2] - XF
        cur = out
    # лёгкая «киношная» обработка: чуть контраста, виньетка
    fc.append(f"[{cur}]eq=contrast=1.04:saturation=1.06,vignette=PI/7[v]")
    video = OUT / "video.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(SRC / "raw.mp4"), "-filter_complex", ";".join(fc), "-map", "[v]",
         "-c:v", "libx264", "-crf", "17", "-preset", "slow", "-pix_fmt", "yuv420p", str(video)])
    return video


# ── Звук ─────────────────────────────────────────────────────────────────────────────────────
rng = np.random.default_rng(7)


def env(n, a=0.005, r=0.2):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / max(r, 1e-4))
    return e


def lowpass(x, cut):
    # однополюсный фильтр, коэффициент может меняться во времени
    cut = np.broadcast_to(np.asarray(cut, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * cut / SR)
    y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def note(f, dur, kind="saw", amp=0.2, a=0.01, r=0.4):
    n = int(dur * SR); t = np.arange(n) / SR
    if kind == "sine":
        w = np.sin(2 * np.pi * f * t)
    else:  # мягкая пила из 6 гармоник
        w = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 7))
    return amp * w * env(n, a, r)


def music(total: float) -> np.ndarray:
    bpm = 118; beat = 60 / bpm
    n = int(total * SR); L = np.zeros(n); R = np.zeros(n)

    def add(sig, t, pan=0.0):
        i = int(t * SR)
        if i >= n: return
        sig = sig[: n - i]
        L[i:i + len(sig)] += sig * (1 - max(0, pan)); R[i:i + len(sig)] += sig * (1 + min(0, pan))

    chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]   # Am F C G
    mtof = lambda m: 440 * 2 ** ((m - 69) / 12)  # noqa: E731
    bar = 4 * beat
    for b in range(int(total / bar) + 1):
        ch = chords[b % 4]
        for m in ch:   # пэд
            pad = note(mtof(m), bar * 1.05, "saw", 0.035, a=0.4, r=2.5)
            add(lowpass(pad, 1400), b * bar, pan=0.3 if m == ch[1] else -0.2)
        add(note(mtof(ch[0] - 24), bar, "sine", 0.22, a=0.01, r=1.2), b * bar)        # саб-бас
        for s in range(8):   # арпеджио восьмыми
            m = ch[s % 3] + (12 if s % 4 == 3 else 0)
            add(note(mtof(m + 12), beat / 2, "saw", 0.045, a=0.003, r=0.12), b * bar + s * beat / 2, pan=(-0.4 if s % 2 else 0.4))
    kick_n = int(0.35 * SR); tk = np.arange(kick_n) / SR
    kick = np.sin(2 * np.pi * (45 + 90 * np.exp(-tk * 28)) * tk) * np.exp(-tk * 9) * 0.55
    hat = rng.standard_normal(int(0.05 * SR)); hat = (hat - lowpass(hat, 6000)) * env(len(hat), 0.001, 0.015) * 0.12
    clap = rng.standard_normal(int(0.2 * SR)); clap = (clap - lowpass(clap, 1200)) * env(len(clap), 0.002, 0.06) * 0.18
    for k in range(int(total / beat) + 1):
        t = k * beat
        if t < 1.2: continue          # заставка — только пэд и удар
        add(kick, t)
        if k % 4 in (1, 3): add(clap, t, pan=0.1)
        add(hat, t + beat / 2, pan=0.35)
    return np.stack([L, R], 1)


def whoosh(dur=0.5, up=True):
    n = int(dur * SR); x = rng.standard_normal(n)
    sweep = np.linspace(500, 6000, n) if up else np.linspace(6000, 500, n)
    y = lowpass(x, sweep) - lowpass(x, sweep * 0.25)
    shape = np.sin(np.linspace(0, np.pi, n)) ** 2
    return y * shape * 0.5


def click():
    n = int(0.06 * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * 2200 * t) * np.exp(-t * 90) * 0.35 + rng.standard_normal(n) * np.exp(-t * 400) * 0.15
    return s


def impact():
    n = int(1.6 * SR); t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * (38 + 70 * np.exp(-t * 12)) * t) * np.exp(-t * 2.8) * 0.75
    noise = lowpass(rng.standard_normal(n), 2500) * np.exp(-t * 6) * 0.35
    shimmer = sum(np.sin(2 * np.pi * f * t) for f in (880, 1320, 1760)) * np.exp(-t * 2.2) * 0.04
    return boom + noise + shimmer


def riser(dur=1.0):
    n = int(dur * SR); x = rng.standard_normal(n)
    y = lowpass(x, np.linspace(300, 9000, n)) * np.linspace(0, 1, n) ** 2 * 0.35
    return y


def build_audio(starts, total) -> Path:
    mix = music(total) * 0.85
    def put(sig, t, gain=1.0, pan=0.0):
        i = int(max(0, t) * SR)
        if i >= len(mix): return
        sig = sig[: len(mix) - i] * gain
        mix[i:i + len(sig), 0] += sig * (1 - max(0, pan)); mix[i:i + len(sig), 1] += sig * (1 + min(0, pan))
    # переходы — «вжух» под каждый стык
    for i in range(1, len(SEGMENTS)):
        put(whoosh(0.55, up=i % 2 == 1), starts[i] - 0.18, 0.8, pan=(0.3 if i % 2 else -0.3))
    put(impact(), 0.0, 1.0)
    events = json.loads((SRC / "events.json").read_text(encoding="utf-8"))
    t0 = json.loads((SRC / "frames.json").read_text())[0]
    for e in events:
        t = map_time(e["t"] - t0, starts)
        if t is None: continue
        if e["type"] == "click": put(click(), t, 0.9, pan=0.15)
        if e["type"] == "impact" and t > 1: put(impact(), t, 0.55)
    put(riser(1.1), starts[-1] - 1.1, 0.7)
    put(impact(), starts[-1] + XF * 0.5, 1.0)
    # мастер: мягкое ограничение, затухание в конце
    fade = np.ones(len(mix)); k = int(1.2 * SR); fade[-k:] = np.linspace(1, 0, k)
    mix = np.tanh(mix * 1.3) * fade[:, None]
    mix /= max(1e-9, np.abs(mix).max()) / 0.89
    path = OUT / "audio.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((mix * 32767).astype("<i2").tobytes())
    return path


def main():
    starts, total = timeline()
    print(f"длительность ролика {total:.1f} с")
    video = build_video(starts, total)
    audio = build_audio(starts, total)
    final = OUT / "allur-flow-promo.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-i", str(audio), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
         "-shortest", "-movflags", "+faststart", str(final)])
    # короткий GIF для README: 3D → План → Схема → финал, 800 px, 10 к/с
    gif = OUT / "allur-flow-promo.gif"
    cut = f"[0:v]trim={starts[1]}:{starts[4]},setpts=PTS-STARTPTS[a];[0:v]trim={starts[-1]}:{total},setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1[c];" \
          f"[c]fps=10,scale=800:-1:flags=lanczos,split[x][y];[x]palettegen=max_colors=128:stats_mode=diff[p];[y][p]paletteuse=dither=sierra2_4a"
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-filter_complex", cut, str(gif)])
    for p in (final, gif):
        print(p.name, f"{p.stat().st_size / 1e6:.1f} МБ")


if __name__ == "__main__":
    main()
