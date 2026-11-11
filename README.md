# HIDDEN SIDE V2 · v0.4.15

A browser-based, local GPU image/video transformation tool using p5.js 1.11.13 and WebGL1 (GLSL ES 1.00).

## Fixes in v0.4.15

- **GHOST and SEEP PNG output:** the v0.4.12 still-image export cleared the feedback textures before rendering the high-resolution image, so previously accumulated temporal effects disappeared in the exported PNG. Export now uses the existing preview history without resetting or modifying it.
- **History continuity:** returning from high-resolution PNG output no longer resets TRAIL or the feedback ring. The low-resolution preview resumes with its previous memory intact.
- **Stable still capture:** the preview draw loop is suspended while the high-resolution PNG is rendered and encoded, preventing it from overwriting the export canvas. The regular preview is restored *before* opening the share sheet, even if encoding fails.
- **No aesthetic changes:** GHOST's color/melt shader, other five modes, variants, CALM/BREAK, RESEED, ACCIDENT/TUNE/TEST and recording algorithms are unchanged.
- Updated cache and asset versions to `0415`.

## Preview and output

- **QUALITY** controls the preview: ECO 520px / BALANCED 720px / FINE 960px (long edge).
- **OUTPUT STANDARD:** photos up to 2048px, video up to 1280px (long edge).
- **OUTPUT HIGH:** photos up to 3072px, video up to 1920px (long edge).
- **OUTPUT MAX:** photos up to 4096px, video up to 2560px (long edge).
- Output size never exceeds the source dimensions. PNG export maintains temporal memory using the preview's lower-resolution feedback texture; its history is not natively 4K.
- MediaRecorder export is browser/codec dependent. Recording lasts at most 45 seconds and does not include audio. High-resolution recording requires GPU and encoder headroom.

## Deploy

Upload all files to an HTTPS folder (e.g. GitHub Pages). Replace the full previous version, including `sw.js` and `index.html`, then reload the page. On older cached installations, clear the website's storage/service worker if necessary.

## Supported media

Photos: JPEG, PNG, and other browser-decodable image types. HEIC/HEIF may need optional on-demand conversion via `heic2any` from a CDN. Videos: supported MP4/MOV/WebM codecs depending on browser. Imported media stays local; p5.js is loaded from a CDN.

## Verification limitations

- JavaScript syntax, WebGL1 shader compile/link on software OpenGL ES, and export state/lifecycle logic have been checked.
- Real iPhone Safari GPU rendering, share sheet behavior, 4K photo export, and high-resolution MediaRecorder output have not been tested on a physical device.
