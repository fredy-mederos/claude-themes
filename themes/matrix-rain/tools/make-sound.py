"""Synthesizes sounds/turn-end.wav: the chime Matrix Rain plays when Claude
finishes a reply. Pure standard library; run it again to remake the file:

    python3 tools/make-sound.py

"Deep pulse": one low thump whose pitch drops, a dark A minor nine chord of
detuned saws that swells in and breathes out, and a faint high shimmer.
About 1.7 seconds, mono, 44.1 kHz. The thump sits at 50-95 Hz with overtones,
so laptop speakers and headphones carry it; a phone speaker mostly plays the
chord.
"""
import math
import os
import struct
import wave

RATE = 44100
LENGTH = 1.7
TAU = 2 * math.pi
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sounds', 'turn-end.wav')

n = int(RATE * LENGTH)
buf = [0.0] * n


def note(semitones_from_a4):
    return 440.0 * 2 ** (semitones_from_a4 / 12)


def add(target, start, dur, fn):
    i0 = int(start * RATE)
    for i in range(int(dur * RATE)):
        if i0 + i < len(target):
            target[i0 + i] += fn(i / RATE)


def lowpass(xs, cutoff):
    a = 1 - math.exp(-TAU * cutoff / RATE)
    y, out = 0.0, []
    for x in xs:
        y += a * (x - y)
        out.append(y)
    return out


# 1. The thump: a sine falling from 95 to 50 Hz, with its octave, gone in
#    under a second.
def thump(t):
    ph = TAU * (50 * t + 45 * (1 - math.exp(-t * 30)) / 30)
    return 0.55 * math.exp(-t * 7) * (math.sin(ph) + 0.35 * math.sin(2 * ph))


add(buf, 0.0, 0.9, thump)

# 2. The chord: A3 C4 E4 G4 B4, two saws each, slightly detuned, swelling in
#    over 120 ms and breathing out by 1.6 s, darkened by two low-passes.
pad = [0.0] * n
for st in (-12, -9, -5, -2, 2):
    for det in (-0.004, 0.004):
        f = note(st) * (1 + det)

        def saw(t, f=f):
            env = min(1.0, t / 0.12) * (0.5 + 0.5 * math.cos(math.pi * min(t / 1.6, 1.0)))
            return 0.035 * env * (2 * ((f * t) % 1.0) - 1)

        add(pad, 0.02, LENGTH, saw)
pad = lowpass(lowpass(pad, 900), 1400)
buf = [x + y for x, y in zip(buf, pad)]


# 3. The shimmer: a quiet A6 that fades with the chord.
def shimmer(t):
    return 0.03 * min(1.0, t * 20) * math.exp(-t * 3) * math.sin(TAU * note(24) * t)


add(buf, 0.05, 1.4, shimmer)

# Normalize to a gentle peak; a 2 ms fade in and a 60 ms fade out.
peak = max(abs(x) for x in buf) or 1.0
gain = 0.55 / peak
fin, fout = int(0.002 * RATE), int(0.06 * RATE)
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
