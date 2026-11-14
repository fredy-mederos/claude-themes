"""Synthesizes sounds/turn-end.wav: the chime Matrix Rain plays when Claude
finishes a reply. Pure standard library; run it again to remake the file:

    python3 tools/make-sound.py

A cascade of soft, slightly bit-crushed digital blips falling down a minor
pentatonic scale, over a low hum that swells and settles, ending on a quiet
open fifth. About 1.2 seconds, mono, 44.1 kHz.
"""
import math
import os
import random
import struct
import wave

RATE = 44100
LENGTH = 1.25
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sounds', 'turn-end.wav')

random.seed(7)
n = int(RATE * LENGTH)
buf = [0.0] * n


def note(semitones_from_a4):
    return 440.0 * 2 ** (semitones_from_a4 / 12)


def add(start, dur, fn):
    i0 = int(start * RATE)
    for i in range(int(dur * RATE)):
        if i0 + i < n:
            buf[i0 + i] += fn(i / RATE)


def crush(x, levels=24):
    return round(x * levels) / levels


# 1. The cascade: ten blips, high to low, each a sine with a little odd
#    harmonic, crushed to a few levels for a digital edge, quick decay.
scale = [0, 3, 5, 7, 10]  # A minor pentatonic
steps = [24 + scale[i % 5] - 12 * (i // 5) for i in range(10)][::-1]
steps = sorted(steps, reverse=True)
for k, st in enumerate(steps):
    f = note(st) * (1 + random.uniform(-0.004, 0.004))
    t0 = 0.02 + k * 0.052
    amp = 0.20 * (0.75 + 0.25 * random.random())

    def blip(t, f=f, amp=amp):
        env = math.exp(-t * 38) * min(1.0, t * 900)
        w = math.sin(2 * math.pi * f * t) + 0.18 * math.sin(2 * math.pi * 3 * f * t)
        return amp * env * crush(w / 1.18)

    add(t0, 0.16, blip)

# 2. The hum: a low sine gliding 62 -> 46 Hz, swelling in and out.
def hum(t):
    f = 62 - 16 * (t / 1.1)
    env = math.sin(math.pi * min(t / 1.1, 1.0)) ** 2
    return 0.16 * env * math.sin(2 * math.pi * f * t)


add(0.0, 1.1, hum)

# 3. The settle: a quiet open fifth (A4 + E5) that rings out.
def fifth(t):
    env = min(1.0, t * 40) * math.exp(-t * 4.2)
    return 0.07 * env * (math.sin(2 * math.pi * note(0) * t) + 0.8 * math.sin(2 * math.pi * note(7) * t))


add(0.55, 0.7, fifth)

# 4. A breath of static under the cascade.
def hiss(t):
    env = math.sin(math.pi * min(t / 0.6, 1.0)) * 0.018
    return env * random.uniform(-1, 1)


add(0.0, 0.6, hiss)

# Normalize to a gentle peak and fade the last 60 ms.
peak = max(abs(x) for x in buf) or 1.0
gain = 0.55 / peak
fade = int(0.06 * RATE)
for i in range(n):
    g = gain * (min(1.0, (n - i) / fade))
    buf[i] *= g

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with wave.open(OUT, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x)) * 32767)) for x in buf))
print('wrote', os.path.normpath(OUT))
