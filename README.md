# MMZ Media Converter

Cross-platform desktop application (Linux and Windows) for converting **videos, audio, images, and documents**, built with **Electron + Node.js** and a modern web interface (HTML5, CSS3, and JavaScript).

> Convert files individually or in batches, choose the destination folder, file names, and quality — all in Portuguese, Spanish, or English, with light or dark themes.

---

## Table of Contents

- [Features](https://chatgpt.com/c/6ae6c227-002c-83e8-b1db-4c61dc044b27?temporary-chat=true#features)

- [Supported Formats](https://chatgpt.com/c/6ae6c227-002c-83e8-b1db-4c61dc044b27?temporary-chat=true#supported-formats)

- [System Requirements](https://chatgpt.com/c/6ae6c227-002c-83e8-b1db-4c61dc044b27?temporary-chat=true#system-requirements)

- [Installation and Setup](https://chatgpt.com/c/6ae6c227-002c-83e8-b1db-4c61dc044b27?temporary-chat=true#installation-and-setup)

- [Project Structure](https://chatgpt.com/c/6ae6c227-002c-83e8-b1db-4c61dc044b27?temporary-chat=true#project-structure)

- [Building the Application](https://chatgpt.com/c/6ae6c227-002c-83e8-b1db-4c61dc044b27?temporary-chat=true#building-the-application)

- [Contributing](https://chatgpt.com/c/6ae6c227-002c-83e8-b1db-4c61dc044b27?temporary-chat=true#contributing)

- [License](https://chatgpt.com/c/6ae6c227-002c-83e8-b1db-4c61dc044b27?temporary-chat=true#license)

---

## Features

- **Individual and batch conversion** with a managed queue (configurable simultaneous conversion limit).

- **Drag-and-drop area** for files, plus file selection through the system dialog.

- **Pause, resume, and cancel** the entire queue or individual files.

- **Individual progress bar** for each file, displaying its status (queued, converting, completed, error, or canceled).

- **Editable output format** for each file before starting the conversion.

- **Configurable destination folder** and overwrite protection (automatically generates `filename (1).ext`, `filename (2).ext`, etc.).

- **File naming modes:** keep original name, add a suffix, or add a prefix.

- **Quality settings:** High, Balanced, or Smaller File Size (automatically adjusts CRF/bitrate).

- **Optional metadata preservation** for audio and video files.

- **Internationalization (i18n):** Portuguese (Brazil) — default, English, and Spanish, with separate JSON files.

- **Light and dark themes** with smooth transitions.

- **FFmpeg auto-detection** (local copy in `ffmpeg/bin`, system PATH, or custom path).

- Individual error handling: a failure in one file does not interrupt the remaining queue.

## Supported Formats

| Category  | From / To                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| Video     | MP4, AVI, MKV, MOV, WMV, FLV, WebM                                                                                       |
| Audio     | MP3, WAV, FLAC, AAC, OGG, WMA                                                                                            |
| Images    | JPG, PNG, GIF, BMP, SVG, WEBP, TIFF (SVG is rasterized; animated GIFs are preserved when supported by the target format) |
| Documents | DOCX → TXT, PDF → TXT, TXT → PDF                                                                                         |

> **Important:** **Video and audio** conversions (as well as BMP output) require **FFmpeg**. Image and document conversions work without it.

---

## System Requirements

- **Node.js** 18+ and **npm** (or yarn/pnpm).

- **FFmpeg** accessible through one of the following methods:
  
  1. Binary included in the project at `ffmpeg/bin/ffmpeg(.exe)` (detected automatically).
  
  2. Installed in the system PATH (`sudo apt install ffmpeg` on Linux, `winget install ffmpeg` on Windows).
  
  3. Manually specified under **Settings → Advanced → FFmpeg Path**.

Tested systems: **Ubuntu/Fedora** (Linux) and **Windows 10/11**.

---

## Installation and Setup

```
# 1. Clone the repositorygit clone https://github.com/mmz/mmz-converter.gitcd mmz-converter# 2. Install dependenciesnpm install# 3. Run in development modenpm start
```

### Tips

- Converted files are saved to `~/MMZ_Convertidos` by default. Change this under **Settings → Output**.

- Local FFmpeg is detected automatically. The notification at the top disappears once FFmpeg is available.

- Settings (theme, language, folder, etc.) are automatically saved to the user's profile.

---

## Project Structure

```
mmz-converter/├── package.json              # Metadata, scripts, and electron-builder configuration├── .gitignore├── ffmpeg/bin/               # (optional) Local FFmpeg binary used by the application├── src/                      # Main process (Node.js backend)│   ├── main.js               # Window management, IPC, and FFmpeg auto-detection│   ├── preload.js            # Secure contextBridge and locale loading│   ├── settings.js            # Settings persistence (JSON)│   ├── jobManager.js         # Conversion queue (concurrency, pause, cancellation)│   └── converters/│       ├── media.js          # Video/audio conversions via fluent-ffmpeg│       ├── image.js          # Image conversions via sharp (FFmpeg fallback for BMP)│       └── document.js       # Document conversions (mammoth, pdf-parse, pdf-lib)└── renderer/                 # User interface (frontend)    ├── index.html    ├── css/styles.css        # Light/dark themes using CSS variables    ├── js/    │   ├── i18n.js           # Multilingual text management    │   ├── store.js          # Centralized state management (pub/sub)    │   └── app.js            # UI logic, drag and drop, and queue controls    └── locales/        ├── pt-BR.json        # Portuguese (Brazil) — default        ├── en.json           # English        └── es.json           # Spanish
```

### How It Works Internally

1. The renderer sends the file paths (drag and drop uses `webUtils.getPathForFile`).

2. The `JobManager` creates one **job** per file, calculates the output path, and adds it to the queue.

3. Each job is handled by the appropriate converter (`media`, `image`, or `document`), respecting the concurrency limit.

4. Progress and status updates are sent back to the renderer through IPC (`job:update`) and displayed in the interface in real time.

---

## Building the Application

```
# Package without an installer (quick test)npm run pack# Windows (NSIS installer)npm run dist:win# Linux (AppImage and .deb)npm run dist:linux# Both platforms (requires a compatible environment)npm run dist
```

Generated files are placed in the `dist/` folder. On Linux, build the application on a Linux machine (or use Wine/CI) to generate valid AppImage/.deb packages.

---

## Contributing

1. Fork the repository.

2. Create a feature branch: `git checkout -b feature/my-improvement`.

3. Commit your changes: `git commit -m "feat: add my improvement"`.

4. Push your branch: `git push origin feature/my-improvement`.

5. Open a **Pull Request** describing the issue you fixed or the feature you added.

**Guidelines:**

- Follow the existing coding style (JavaScript CommonJS in the backend, classic ES modules in the renderer).

- Add translation keys to all three locale files (`pt-BR`, `en`, `es`).

- Prefer asynchronous conversions and always report progress and errors to the user.

---

## License

Distributed under the **MIT License**. See [LICENSE](https://chatgpt.com/c/LICENSE) for more details.
