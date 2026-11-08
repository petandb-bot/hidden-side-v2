# HIDDEN SIDE V2 · 0.3.9

A local, GPU-processed image and video excavator built with p5.js 1.11.13 and WebGL1.

## What changed

- Fixed unsupported GLSL ES 1.00 `tanh` in the structure-field shader.
- Rebuilt photo import around `createImageBitmap` with an HTML Image fallback.
- Added optional HEIC/HEIF conversion using `heic2any` loaded only when required. The decoder requires internet access on first use.
- Failed image selections no longer clear the current image.
- Import errors are shown in the status bar and browser console.
- Updated the v2 icon, home-screen name, manifest ID, and service worker revision.

## Deploy

Place all files in a dedicated HTTPS directory such as `/hidden-side-v2/`, and open its `index.html`.
Use Safari's "Add to Home Screen" for iOS. Keep the v1 installation in its original folder.

## Media

Photos: JPG, PNG, WebP, AVIF when supported by the browser, plus HEIC/HEIF via on-demand conversion when native decoding fails.
Videos: MP4/MOV/WebM only if the device/browser supports the contained codec.

Still-image export: PNG. Video export: browser-dependent WebM or MP4, muted, up to 45 seconds. GPU presets: ECO, BALANCED, FINE.

## Notes

The image decoder and recording support vary by browser. HEIC conversion is local to the browser, but loads a third-party decoding script on demand from a CDN. This project does not upload user media to a server. The p5.js runtime is also loaded from a CDN.
