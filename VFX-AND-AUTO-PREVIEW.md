# OTTO: Automatic Preview and Local VFX

## Automatic Preview

Enabled by default. The queue renders the current source-accurate composition frame,
recently visited frames, and a short look-ahead window into the same RAM cache used
by manual previews. Scrubbing reprioritizes the queue without waiting for an old
work-area render. Green timeline segments represent frames actually cached, not
imaginary coverage. Auto ON/OFF is independent of the R/manual-render shortcut.

Automatic cache: at most 600 frames / 64 MiB (compressed), 18 decoded bitmaps.
Farthest frames are evicted first. Manual previews retain their existing 192 MiB
budget. Decode/seek work is asynchronous and rendering yields between frames.
This improves repeat playback; it does not guarantee real-time decoding for every
format/effect combination. Transparent comps use PNG rather than JPEG cache.

Changing visual properties, nested comps, media, solo switches, resolution or
audio-reactive inputs invalidates the cache. Selection and playhead changes do not.
Manual rendering has priority; auto work pauses during exports and VFX analysis.

## Source-space VFX

Inspector > VFX. Effects apply to the untransformed source and are then transformed,
masked, color-graded and composited by the existing shared renderer. Video exports,
PNG sequences and automatic/manual previews use identical processing rules.
Analysis data/settings are serialized with the clip and participate in Undo/Redo.

- **Background removal**: median border-color estimation + 4-connected flood fill,
  adjustable tolerance and alpha softness. Ideal for uniform backgrounds. Can
  preserve enclosed details matching the background. Not semantic person/object
  segmentation; complex backgrounds require a separate model/service.
- **Object cleanup**: explicit same-frame texture cloning with feather, or local
  blur/pixelation. No generative inpainting. Select a destination rectangle and
  adjust the source offset to a clean neighboring texture. Optional tracked
  movement follows the analyzed trajectory. Large occlusions/complex textures may
  leave visible artifacts. Source sampling outside the frame is skipped.
- **Track Motion**: zero-mean normalized patch correlation at 256-pixel source width,
  measured at 15 Hz with bidirectional analysis from the selected reference frame.
  Low-texture or lost tracks stop with an error; existing analysis is preserved.
  Paths, confidence and sample counts are measured data. Bake into an overlapping,
  unparented destination's X/Y tracks. Other animation properties are untouched.
- **Stabilization**: median-consensus translation of a 12-point grid, smoothed
  camera trajectory with user-adjustable strength, window and crop. Preserves slow
  pans. Does not solve rotation, scale, rolling shutter, parallax or 3D camera motion.

Analysis uses a separate media element, never seeking the editor's playback element.
It is cancellable, yields between frames, and releases media resources on success,
error, clip change and cancellation. Current safety limit: 60 source-seconds per
analysis. Trim longer sources into segments. Measurements are keyed to SOURCE time
so trimming, splitting and time-remapping do not silently retime them.

No API keys, new dependencies, proprietary plugins or external AI calls are used.