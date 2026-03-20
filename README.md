# XTC.js 📚

**Read manga and comics on your XTEink X4 e-reader!**

<p align="center">
  <a href="https://xtcjs.app">
    <img src="https://img.shields.io/badge/demo-xtcjs.app-0891b2?style=flat&logo=googlechrome&logoColor=white" alt="Live Demo" />
  </a>
    <img src="https://img.shields.io/badge/users-10k+-22c55e?style=flat&logo=starship&logoColor=white" alt="Users" />
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Bun-000000?style=flat&logo=bun&logoColor=white" alt="Bun" />
    <img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat" alt="License" />
</p>

<p align="center">
  <sub>Made with ❤️ by <a href="https://github.com/varo6">varo6</a> & <a href="https://github.com/sodafmr">sodaFMR</a></sub>
</p>


A free, privacy-first web app that converts your CBZ comics, PDFs, images, and videos into XTC format optimized for the XTEink X4 and X3 e-readers.

**[Try it now!](https://xtcjs.app)** — No installation required



##  Features

### 📥 Convert Anything

| Format | What it's for |
|--------|---------------|
|  **CBZ/CBR** | Manga and comic archives |
|  **PDF** | Documents, scanned manga, books |
|  **Images** | JPG, PNG, WEBP for wallpapers and covers |
|  **More** | More Extra Options! |

### ⚡ Optimized for E-Ink

Your content is automatically processed for the best e-ink reading experience:

-  **Smart Dithering** — Floyd-Steinberg, Atkinson, Sierra-Lite, or Ordered
-  **Contrast Enhancement** — Make text and art crisp on grayscale displays  
-  **Auto Page Splitting** — Two-page spreads become individual pages
-  **Perfect Sizing** — Every page fits 480×800 (X4) or 528×792 (X3)

### 🔧 Merge & Split Tools

-  **Merge** — Combine multiple CBZ, PDF, or XTC files into one
-  **Split** — Break large files by page ranges or equal chunks
-  **Chain Workflows** — Split, then convert parts to XTC in one flow

### 📝 Metadata Editor

- Add title, author, and chapter information to XTC files
- Create table of contents for easy navigation on your e-reader


##  Why XTC.js?

| | |
|---|---|
| 🔒 **100% Private** | Everything runs in your browser. Your files never leave your device. |
| 📴 **Works Offline** | Once loaded, use it anywhere without internet. |
| 🎫 **No Account** | Just drop your files and convert. Zero friction. |
| 👁️ **Live Preview** | See exactly how pages will look before downloading. |



##  Quick Start

1. Open [xtcjs.app](https://xtcjs.app) in your browser
2. Drop your CBZ, PDF, or image files
3. Adjust settings (defaults work great)
4. Convert and watch the live preview
5. Download your XTC file
6. Transfer to your XTEink device

---

## Recommended Settings

### 📖 Manga & Comics
| Setting | Value |
|---------|-------|
| Dithering | Floyd-Steinberg |
| Contrast | Medium |
| Split | Overlapping thirds |
| Orientation | Landscape |

### 📄 PDFs & Documents
| Setting | Value |
|---------|-------|
| Dithering | Atkinson |
| Contrast | Strong / Maximum |
| Orientation | Landscape |

### 🖼️ Wallpapers & Covers
| Setting | Value |
|---------|-------|
| Image Scaling | Cover |
| Orientation | Portrait |
| Dithering | Floyd-Steinberg |

---

## ❓ FAQ

<details>
<summary><b>Which dithering algorithm should I use?</b></summary>

- **Floyd-Steinberg** — Best all-rounder for manga with detailed art
- **Atkinson** — Sharper results, great for text-heavy content
- **Sierra-Lite** — Lighter dithering, good for high-contrast art
- **Ordered** — Patterned dithering, retro look
- **None** — Pure black and white, no gradients
</details>

<details>
<summary><b>Why are my pages split in half?</b></summary>

The XTEink X4 has a portrait screen. When you convert landscape images (like two-page manga spreads), XTC.js splits them so you can read each page comfortably. Use "No split" if you prefer full spreads. PDFs also support a "Split by columns (4-way)" option for two-column layouts.
</details>

<details>
<summary><b>Can I use this on my phone?</b></summary>

Yes! XTC.js works on any modern browser. Large files may convert slower on mobile due to limited processing power.
</details>

<details>
<summary><b>What's the XTC format?</b></summary>

XTC is the native format for XTEink e-readers. It contains optimized 1-bit black and white images at the device's resolution, designed for fast page turns and excellent readability.
</details>

<details>
<summary><b>Is there an XTCH format?</b></summary>

XTCH is the 2-bit variant with 4 grayscale levels instead of pure black and white. Some content may look better in XTCH.
</details>

---

## 🙏 Credits

The idea was originally from [cbz2xtc](https://github.com/tazua/cbz2xtc), after porting to typescript, the app gained lots of functionalities maintained by [varo6](https://github.com/varo6) & [sodafmr](https://github.com/sodafmr).

---

## 🛠️ Development

```bash
bun install      # Install dependencies
bun run dev      # Dev server → localhost:5173
bun run build    # Production build
bun run serve    # Production server → localhost:3000
```
