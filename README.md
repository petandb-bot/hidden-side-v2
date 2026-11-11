# HIDDEN SIDE V2 · v0.4.17

A local browser-based image/video processing instrument built with p5.js 1.11.13, WebGL1 / GLSL ES 1.00.

## What's changed in v0.4.17

- **REC / STOP fixed**: The record button remains enabled while recording. The recording-start flag is cleared after `MediaRecorder.start()`, instead of keeping STOP disabled.
- **Safer finishing and saving**: Recordings are assembled before restoring the GPU preview. If preview restoration fails, a captured file can still be downloaded. A stop-event watchdog avoids an indefinitely locked UI.
- **Photo-to-video recording**: The canvas capture track receives rendered frames explicitly on browsers exposing `requestFrame()`; regular `captureStream(fps)` remains supported.
- **Larger preview**: The controls are condensed to give the image more vertical space, with PREVIEW and OUTPUT settings side by side. RANGE and ACCIDENT occupy one row when space allows. The new **FOCUS** control temporarily expands the preview over the screen and can be closed with CLOSE / Escape.
- **Cleaner controls**: Decorative mode numbers and the mode index overlay are hidden. PLAY is hidden while working with photos; it remains available for videos.
- **Preserved processing**: GHOST color/melt shaders, UNDER/SEEP BREAK variants, all five modes, RESEED, and ACCIDENT TUNE / TEST are unchanged.

## Controls and quality

- **PREVIEW** selects the live long-edge resolution: ECO 520px / BALANCED 720px / FINE 960px.
- **OUTPUT STANDARD:** still up to 2048px; video up to 1280px long edge (~720p in 16:9).
- **OUTPUT HIGH:** still up to 3072px; video up to 1920px long edge (~1080p in 16:9).
- **OUTPUT MAX:** still up to 4096px; video up to 2560px long edge (~1440p in 16:9).
- Recordings last at most **45 seconds**, without audio. The encoding format is browser-dependent (WebM/MP4). File dimensions never exceed those of the source.
- High-resolution video may cause frame drops on less capable devices. Try STANDARD if recording fails.

## Use

1. Open `index.html` over HTTPS (e.g. GitHub Pages). Internet access is required to load p5.js from its CDN.
2. Choose a photo/video with IMPORT, adjust processing, then SAVE IMAGE for PNG output.
3. Use FOCUS to examine the image without the control panel (CLOSE or Escape to return). On phones, landscape orientation provides more useful width.
4. To record an animated result, click RECORD and click STOP when finished. Once `VIDEO READY` appears, choose **SAVE FILE** or SHARE VIDEO when supported.
4. On deploying to GitHub Pages, replace **all** project files, including `sw.js`, to update the cached app version.

## Verification and limits

- JavaScript syntax was checked with Node.js.
- A Chromium integration test **with a 2D substitute for the GPU processing renderer** passed photo import -> record -> STOP -> WebM creation -> file download. The saved WebM was decoded as VP8 with multiple frames. The video import -> record -> STOP -> export-dialog flow also passed.
- Responsive layouts at 320×568, 375×667, 390×844, and 1280×800 were checked for horizontal overflow.
- WebGL shader text is unchanged from v0.4.15. Actual GPU rendering, full-resolution recording, and iPhone Safari recording/share-sheet behavior still require real-device testing.
