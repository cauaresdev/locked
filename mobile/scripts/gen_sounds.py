"""Generate the metronome clicks (dry, short square-ish beeps) as 16-bit mono WAV."""

import math
import struct
import sys
import wave
from pathlib import Path

RATE = 44100


def beep(path: Path, freq: float, ms: int, volume: float = 0.6) -> None:
    n = int(RATE * ms / 1000)
    frames = bytearray()
    for i in range(n):
        env = min(1.0, i / 40) * min(1.0, (n - i) / 200)  # avoid clicks at the edges
        s = math.sin(2 * math.pi * freq * i / RATE)
        s = math.copysign(min(1.0, abs(s) * 3), s)  # soft-clipped sine: dry, percussive
        frames += struct.pack("<h", int(32767 * volume * env * s))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(frames))


def alarm(path: Path, seconds: float = 4.0) -> None:
    """Klaxon-like alarm: alternating 880/660 Hz pulses with short gaps."""
    frames = bytearray()
    pulse = int(RATE * 0.18)
    gap = int(RATE * 0.07)
    i = 0
    while len(frames) < RATE * seconds * 2:
        freq = 880 if i % 2 == 0 else 660
        for n in range(pulse):
            env = min(1.0, n / 60) * min(1.0, (pulse - n) / 300)
            s = math.copysign(min(1.0, abs(math.sin(2 * math.pi * freq * n / RATE)) * 2.5),
                              math.sin(2 * math.pi * freq * n / RATE))
            frames += struct.pack("<h", int(32767 * 0.7 * env * s))
        frames += b"\x00\x00" * gap
        i += 1
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(frames))


def pulses(path: Path, freq: float, ms: int, count: int, gap_ms: int, volume: float = 0.8) -> None:
    """Repeated beeps: loud enough to hear from a pocket when rest ends with the screen locked."""
    n = int(RATE * ms / 1000)
    frames = bytearray()
    for k in range(count):
        for i in range(n):
            env = min(1.0, i / 40) * min(1.0, (n - i) / 200)
            s = math.sin(2 * math.pi * freq * i / RATE)
            s = math.copysign(min(1.0, abs(s) * 3), s)
            frames += struct.pack("<h", int(32767 * volume * env * s))
        if k < count - 1:
            frames += b"\x00\x00" * int(RATE * gap_ms / 1000)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(frames))


if __name__ == "__main__":
    out = Path(sys.argv[1])
    beep(out / "tick.wav", 1000, 35)
    beep(out / "phase.wav", 1600, 90)
    beep(out / "done.wav", 600, 250)
    alarm(out / "alarm.wav")
    pulses(out / "rest.wav", 1200, 160, 3, 120)
