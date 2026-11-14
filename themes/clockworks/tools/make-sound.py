"""Synthesizes sounds/turn-end.wav: the chime Clockworks plays when Claude
finishes a reply. Pure standard library; run it again to remake the file:

    python3 tools/make-sound.py

"Run down": five escapement ticks, each a little later and softer than the
one before, as the train coasts to a stop, then one small bell struck once
and left to ring. About 2 seconds, mono, 44.1 kHz.
"""
import math
import os
import random
import struct
import wave

RATE = 44100
LENGTH = 2.1
TAU = 2 * math.pi
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sounds', 'turn-end.wav')

n = int(RATE * LENGTH)
buf = [0.0] * n
rand = random.Random(7)


def add(start, dur, fn):
    i0 = int(start * RATE)
    for i in range(int(dur * RATE)):
        if i0 + i < n:
            buf[i0 + i] += fn(i / RATE)


# 1. The ticks: a short bright click (two damped resonances, like a pallet on
#    an escape wheel), a dull knock under it, and a breath of noise. The gaps
#    widen as the train slows; the last two are the "tock" a touch lower.
def tick(level, pitch):
    noise = [rand.uniform(-1, 1) for _ in range(int(0.012 * RATE))]

    def fn(t):
        click = math.exp(-t * 900) * (math.sin(TAU * 3100 * pitch * t) + 0.6 * math.sin(TAU * 4700 * pitch * t))
        knock = 0.55 * math.exp(-t * 160) * math.sin(TAU * 210 * pitch * t)
        i = int(t * RATE)
        hiss = 0.25 * math.exp(-t * 700) * (noise[i] if i < len(noise) else 0.0)
        return level * (click + knock + hiss)

    return fn


for at, level, pitch in ((0.0, 0.32, 1.0), (0.14, 0.29, 0.94), (0.31, 0.26, 1.0), (0.52, 0.22, 0.94), (0.78, 0.18, 1.0)):
    add(at, 0.06, tick(level, pitch))


# 2. The bell: a small brass bell's inharmonic partials over a quiet hum an
#    octave down, each dying away at its own rate, the high ones first.
F0 = 1046.5  # C6
PARTIALS = ((0.5, 0.25, 1.2), (1.0, 1.0, 1.9), (2.0, 0.45, 3.2), (2.76, 0.32, 4.6), (4.07, 0.18, 7.0), (5.4, 0.1, 9.0))


def bell(t):
    strike = min(1.0, t / 0.002)
    return 0.3 * strike * sum(a * math.exp(-t * d) * math.sin(TAU * F0 * r * t) for r, a, d in PARTIALS)


add(0.98, LENGTH - 0.98, bell)

# Normalize to a gentle peak; a 2 ms fade in and an 80 ms fade out.
peak = max(abs(x) for x in buf) or 1.0
gain = 0.5 / peak
fin, fout = int(0.002 * RATE), int(0.08 * RATE)
frames = b''.join(
    struct.pack('<h', int(max(-1, min(1, x * gain * min(1.0, i / fin, (n - i) / fout))) * 32767)) for i, x in enumerate(buf)
)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with wave.open(OUT, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(frames)
print('wrote', os.path.normpath(OUT))
