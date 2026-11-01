# MMZ Media Converter

A cross-platform desktop media converter built with **Electron**. Convert video, audio, images and documents in batches, with a modern UI, real progress reporting and a fully local/offline pipeline (FFmpeg is bundled, no uploads, no cloud).

> Windows · Linux · UI in **English**, **Portuguese (pt-BR)** and **Spanish (es)**

---

## Features

- **All-in-one conversion** — video, audio, images and documents in a single queue.
- **Drag & drop** files or pick them with a native dialog (multi-select supported).
- **Batch conversion queue** with:
  - configurable parallelism (1–6 simultaneous conversions);
  - pause / resume (real process suspension on Linux/macOS);
  - cancel, retry and remove individual jobs, or cancel/clear everything;
  - per-job and overall progress bars with real speed/FPS from FFmpeg.
- **Quality presets** — `low`, `medium`, `high`, `ultra` mapped to CRF, video `qscale` and audio bitrates per codec.
- **Smart output naming** — keep the original name or add a custom suffix, with automatic collision-free naming (`file (1).mp4`, `file (2).mp4`, …).
- **Flexible destination** — a single output folder or "next to the source file".
- **Local FFmpeg detection** — uses the bundled `ffmpeg/bin/` copy first and falls back to the system `PATH`; the header shows the FFmpeg status chip.
- **Modern UI** — dark/light theme, persisted window size/position, toasts, status bar, keyboard-accessible controls.
- **Offline & private** — everything runs on your machine; files are never uploaded.
- **Secure by default** — `contextIsolation` enabled, no Node access in the renderer, all IPC validated through a whitelist.

## Supported formats

| Category | Output formats | Accepted inputs (examples) |
| --- | --- | --- |
| **Video** | MP4 (H.264 + AAC), AVI, MKV, MOV, WMV, FLV, WebM (VP9 + Opus) | mp4, avi, mkv, mov, wmv, flv, webm, m4v, mpg, mpeg, 3gp, ts, mts, m2ts, vob, ogv, divx |
| **Audio** | MP3, WAV, FLAC, AAC, OGG, WMA | mp3, wav, flac, aac, ogg, wma, m4a, opus, aif, aiff, amr, ape |
| **Image** | JPG, PNG, GIF, BMP, SVG, WebP, TIFF | jpg, jpeg, png, gif, bmp, svg, webp, tiff, tif, avif |
| **Document** | PDF, DOCX, TXT | pdf, docx, txt |

Conversion engines:

- **FFmpeg / ffprobe** — video and audio, with real progress via `-progress pipe:1`; also the fallback path for images (e.g. BMP, which `sharp` does not support).
- **sharp** — fast native image conversion with EXIF auto-rotation, animated GIF/WebP preservation and SVG output (raster embedded as base64).
- **mammoth / pdf-parse** + custom writers — document conversions between `TXT ↔ PDF ↔ DOCX`.

## Tech stack

| Layer | Choice |
| --- | --- |
| Desktop shell | Electron 45 (main + sandboxed renderer) |
| Video/audio | FFmpeg & ffprobe (bundled binaries) |
| Images | sharp |
| Documents | mammoth, pdf-parse, custom PDF/DOCX writers |
| Packaging | electron-builder (NSIS + portable on Windows, AppImage + deb on Linux) |

## Getting started

### Prerequisites

- Node.js 18+ and npm
- FFmpeg is **not** required to be installed — the repository ships with binaries in `ffmpeg/bin/`. If you delete that folder, the app falls back to an `ffmpeg`/`ffprobe` available on your system `PATH`.

### Install and run

```bash
git clone https://github.com/misbka/MMZ-Media-Converter.git
cd MMZ-Media-Converter
npm install
npm start          # normal launch
npm run dev        # launch with devtools
```

## Testing

```bash
npm run smoke      # headless smoke test of every converter + the queue (no Electron window)
npm run test:app   # launches the app in --smoke-test mode (CI-friendly)
```

The smoke test verifies FFmpeg detection, video/audio/image/document conversion across all target formats, output naming and queue events.

## Building installers

```bash
npm run pack        # unpacked build into dist/ (fast, for local checks)
npm run dist:win    # Windows → NSIS installer + portable .exe
npm run dist:linux  # Linux → AppImage + .deb
```

Bundled FFmpeg binaries are copied into the installer automatically (`extraResources`), so end users need no separate FFmpeg installation.

## Project structure

```
.
├── main.js                  # Electron main-process entry (window, settings, queue, IPC)
├── preload.js               # contextBridge → exposes the window.mmz API to the renderer
├── shared/
│   └── formats.js           # single source of truth: formats, quality maps, FFmpeg args
├── src/
│   ├── main/                # main-process modules
│   │   ├── settingsStore.js # persisted JSON preferences (userData/settings.json)
│   │   ├── binaryLocator.js # finds bundled/system FFmpeg + ffprobe
│   │   ├── i18n.js          # translation dictionaries loader
│   │   ├── ipc.js           # all IPC channels (settings, dialogs, queue, shell)
│   │   └── conversion/
│   │       ├── queue.js             # job queue: parallelism, pause/resume, events
│   │       ├── ffmpegConverter.js   # video/audio with progress + cancellation
│   │       ├── imageConverter.js    # sharp-based image conversion + fallbacks
│   │       ├── documentConverter.js # TXT ↔ PDF ↔ DOCX
│   │       └── outputNamer.js       # collision-free output path resolution
│   ├── i18n/                # en.json, pt-BR.json, es.json
│   ├── renderer/            # UI (HTML/CSS/vanilla JS modules)
│   └── utils/               # pdfWriter.js, zipWriter.js
├── scripts/
│   └── smoke-test.js        # headless end-to-end smoke test
└── ffmpeg/bin/              # bundled ffmpeg, ffprobe, ffplay (offline use)
```

## How it works

1. Files are dropped into the queue; each one is categorized by extension using the shared format registry.
2. The user picks an output format and quality per category (persisted in `settings.json`).
3. On **Start**, the `ConversionQueue` runs up to *N* jobs in parallel. FFmpeg work happens in child processes, so the UI never blocks; sharp work is off the main thread by nature.
4. Progress events (throttled to ~250 ms) flow `queue → IPC → renderer` and update per-job and overall progress.
5. Outputs get unique names, and you can open the destination folder or reveal a file directly from the UI.

## Roadmap ideas

- [ ] Custom FFmpeg path setting + in-app codec/bitrate controls
- [ ] Video trimming, resizing and audio extraction (video → audio)
- [ ] Image resizing and batch watermarking
- [ ] Persistent conversion history and drag-and-drop of whole folders
- [ ] macOS build targets (dmg)

Contributions and issue reports are welcome.

## License

[MIT](LICENSE) © MMZ
