# HIDDEN SIDE v0.3.8

GPU-based image excavator for photographs and video. WebGL1 and p5.js 1.11.13.

## Setup

Deploy all files together to an HTTPS static host (for example, GitHub Pages). Open with iPhone Safari or a desktop browser. For local development, use an HTTP development server. The p5.js runtime is loaded from the CDN, so an internet connection is required for the initial load.

## Controls

- Choose UNDER / NEGATIVE / RELIEF / SEEP / GHOST.
- Each mode keeps two distinct profiles. GHOST offers a separate TRAIL slider.
- DEPTH, EROSION and DRIFT influence image reconstruction and animation.
- Tap or drag on the image to disturb local structure.
- RESEED regenerates spatial relationships within the image (LAMINA / FAULT / ORBIT / CELLS), not just noise values.
- QUALITY adjusts preview and recording resolution.

## Recording and export

- SAVE IMAGE exports PNG from photos or video frames.
- RECORD captures the processed WebGL canvas as video, including motion generated from a still photograph.
- Press STOP to finish; the maximum recording duration is 45 seconds.
- Chrome prioritizes WebM/VP8; supported Safari versions may choose MP4. Output is silent.
- Recording runs in real time; actual output frame rate depends on device load.
- Media is processed locally; files are not uploaded to a server.

## Limitations

- No embedded source audio, frame-accurate video conversion, or 4K export.
- High GPU load can reduce recording frame rate on phones.
- When updating GitHub Pages, refresh cached app resources if the prior version is still shown.

## Version changes

**v0.3.5 — STRUCTURAL RESEED.** Each activation selects a different spatial family and changes its rotation, scale, deformation and offset. The imported image remains close to the v0.3.4 baseline before RESEED. The feedback buffer is reset when RESEED is pressed.

**v0.3.6 — DISTINCT VARIANTS.** UNDER/WILD develops fractured strata; NEGATIVE/BLEACH adds local solarisation and silver/paper thresholds; RELIEF/HALO introduces luminous contours; SEEP/FILM responds with interference coloration; GHOST/DENSE adds a second chromatic apparition. Their alternate profiles retain the quieter original material.

**v0.3.8 — RARE ACCIDENTS.** Four local events can occur without an explicit action: fracture, chemical reversal, displaced double exposure and pigment melt. Events are scheduled roughly 22–53 seconds after importing media and then 37–92 seconds after a completed event. They last around 1.15–2.75 seconds and decay automatically. DRIFT at zero suppresses visible accident intensity. No new UI or render buffers are used.
