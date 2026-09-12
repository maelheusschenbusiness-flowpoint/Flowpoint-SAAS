---
name: FFmpeg still-image zoompan duration
description: Prevents accidental multi-minute outputs when animating still screenshots into short videos.
---

When a still image is already supplied as a timed frame stream with `-loop 1`, use `zoompan` with `d=1`. Do not set `d` to the intended total frame count.

**Why:** `zoompan d=N` emits N output frames for every input frame. Combined with a looped 25 fps still input, a planned 15-second clip can become many minutes long and time out during encoding.

**How to apply:** Let the input duration and output frame rate control clip length; use `d=1` and update the zoom expression once per incoming frame.