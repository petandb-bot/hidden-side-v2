# HIDDEN SIDE V2 · 0.4.12

A local, GPU-processed image and video excavator built with p5.js 1.11.13 and WebGL1.

## v0.4.12 — Import / shader startup repair

- Fixed two premature references to `outline` in the UNDER and SEEP BREAK displacement paths. `outline` is only computed after source sampling, so v0.4.10 failed to compile its WebGL1 fragment shader at application startup; both photo and video import were consequently blocked.
- Kept the intended soft-field slip and shadow-displacement effects independent of the downstream edge calculation. No new block/rectangle effects were introduced.
- Preserved v0.4.9 GHOST smoothing, five modes, variants, CALM/BREAK, RESEED, ACCIDENT TUNE/TEST, import/export and recording.
- Updated script/style query strings and the PWA service-worker cache key to 0412.
- Confirmed GLSL ES 1.00 compilation and program linking using Mesa's surfaceless OpenGL ES2 implementation.
- Confirmed 120 software-GPU draw calls (5 modes × 2 variants × 2 range settings × 6 RESEED families) without OpenGL errors.
- Checked browser-side image/video import logic with an isolated GPU stub: PNG/JPEG photos, valid WebM video, invalid video preserving both an existing photo and an existing video. Browser-native GPU initialization, full recording and iPhone Safari remain untested.

## Previous changes

- Fixed unsupported GLSL ES 1.00 `tanh` in the structure-field shader.
- Rebuilt photo import around `createImageBitmap` with an HTML Image fallback.
- Added optional HEIC/HEIF conversion using `heic2any` loaded only when required. The decoder requires internet access on first use.
- Failed image selections no longer clear the current image.
- Import errors are shown in the status bar and browser console.
- V2 uses its own icon, home-screen name, manifest ID, and service worker revision.

## Deploy

Place all files in a dedicated HTTPS directory such as `/hidden-side-v2/`, and open its `index.html`.
Use Safari's "Add to Home Screen" for iOS. Keep the v1 installation in its original folder.

## Media

Photos: JPG, PNG, WebP, AVIF when supported by the browser, plus HEIC/HEIF via on-demand conversion when native decoding fails.
Videos: MP4/MOV/WebM only if the device/browser supports the contained codec.

Still-image export: PNG. Video export: browser-dependent WebM or MP4, muted, up to 45 seconds. GPU presets: ECO, BALANCED, FINE.

## Notes

The image decoder and recording support vary by browser. HEIC conversion is local to the browser, but loads a third-party decoding script on demand from a CDN. This project does not upload user media to a server. The p5.js runtime is also loaded from a CDN.
