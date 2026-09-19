# XTC.js

**Read manga and comics on your reader.**

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

A free, privacy-first web app that converts your CBZ comics, PDFs, images, and videos into XTC format for your reader. XTC.js is growing beyond a single device: choose your reader to size the pages for its screen, then preview and download your files.

**New: Sticky support.** Convert for reTerminal Sticky running CrossPoint Reader, alongside XTEink X4, X4 Pro, and X3. [Read the introduction](https://xtcjs.app/blog/introducing-sticky).

[Open XTC.js](https://xtcjs.app) · [Read the blog](https://xtcjs.app/blog)

No installation or account required.

## Supported readers

| Reader | Page canvas | Notes |
|--------|-------------|-------|
| XTEink X4 / X4 Pro | 480×800 | Select X4 / Pro |
| XTEink X3 | 528×792 | Select X3 |
| Seeed Studio reTerminal Sticky | 480×800 | Requires CrossPoint Reader firmware |

Sticky's preset uses the page canvas expected by CrossPoint Reader. Generated XTC files are not compatible with the original Seeed firmware.

## Features

### Convert for your reader

| Input | What it's for |
|-------|---------------|
| CBZ / CBR | Manga and comic archives |
| PDF | Documents, scanned manga, and books |
| Images | JPG, PNG, and WEBP wallpapers and covers |
| Video | Convert video frames to XTC pages |

- Choose Floyd-Steinberg, Atkinson, Sierra-Lite, Ordered, or no dithering.
- Adjust contrast and preview the result before downloading.
- Split spreads to fit your reader, or keep them whole.
- Select your device to use the matching page size.

### Merge, split, and edit metadata

- Combine CBZ, PDF, or XTC files.
- Split files by page ranges or into equal chunks, then convert the parts.
- Add title, author, and chapter information to XTC files.
- Create a table of contents for navigation on your reader.

## Blog

The [XTC.js blog](https://xtcjs.app/blog) covers new readers and app updates. Start with [Introducing Sticky](https://xtcjs.app/blog/introducing-sticky) for setup instructions and the move toward supporting more devices.

The blog has its own reading layout, article cards, and responsive banners. A small Blog link beside the theme toggle keeps it accessible from the app.

## Why XTC.js?

| | |
|---|---|
| 🔒 **100% Private** | Everything runs in your browser. Your files never leave your device. |
| 📴 **Works Offline** | Once loaded, use it anywhere without internet. |
| 🎫 **No Account** | Just drop your files and convert. Zero friction. |
| 👁️ **Live Preview** | See exactly how pages will look before downloading. |

## Quick start

1. Open [xtcjs.app](https://xtcjs.app) in your browser
2. Drop your CBZ, PDF, or image files
3. Select your reader and adjust settings
4. Convert and watch the live preview
5. Download your XTC file
6. Transfer to your reader

For reTerminal Sticky, install CrossPoint Reader first. The generated XTC files are not compatible with the original Seeed firmware.

---

## Suggested settings

### Manga and comics

| Setting | Value |
|---------|-------|
| Dithering | Floyd-Steinberg |
| Contrast | Medium |
| Split | Overlapping thirds |
| Orientation | Landscape |

With **Split wide pages (right to left)** enabled, wide CBZ/CBR images are
treated as double-page spreads. Each half uses the selected thirds/halves
split, starting with the right page. The first image stays whole for the cover.
Uncheck this option to keep panoramic artwork together, or choose **No split**
to keep every source page whole. This is geometric splitting, not panel detection.

### PDFs and documents

| Setting | Value |
|---------|-------|
| Dithering | Atkinson |
| Contrast | Strong / Maximum |
| Orientation | Landscape |

### Wallpapers and covers

| Setting | Value |
|---------|-------|
| Image Scaling | Cover |
| Orientation | Portrait |
| Dithering | Floyd-Steinberg |

---

## FAQ

<details>
<summary><b>Which dithering algorithm should I use?</b></summary>

- **Floyd-Steinberg**: Best all-rounder for manga with detailed art
- **Atkinson**: Sharper results, great for text-heavy content
- **Sierra-Lite**: Lighter dithering, good for high-contrast art
- **Ordered**: Patterned dithering, retro look
- **None**: Pure black and white, no gradients
</details>

<details>
<summary><b>Why are my pages split in half?</b></summary>

When you convert landscape images, such as two-page manga spreads, XTC.js can split them to fit your reader. Use "No split" if you prefer full spreads. PDFs also support a "Split by columns (4-way)" option for two-column layouts.
</details>

<details>
<summary><b>Can I use this on my phone?</b></summary>

Yes! XTC.js works on any modern browser. Large files may convert slower on mobile due to limited processing power.
</details>

<details>
<summary><b>What's the XTC format?</b></summary>

XTC is a page image format for compatible e-ink readers. It contains optimized 1-bit black and white images at the device's resolution, designed for fast page turns and excellent readability.
</details>

<details>
<summary><b>Is there an XTCH format?</b></summary>

XTCH is the 2-bit variant with 4 grayscale levels instead of pure black and white. Some content may look better in XTCH.
</details>

---

## Credits

XTC.js started as a TypeScript port of [cbz2xtc](https://github.com/tazua/cbz2xtc). It is maintained by [varo6](https://github.com/varo6) and [sodafmr](https://github.com/sodafmr).

Thank you to the [Seeed Studio team behind reTerminal Sticky](https://www.seeedstudio.com/sticky/). We're happy to bring Sticky to XTC.js, and we hope to keep working with them to make reading on it even better.

---

## Development

```bash
bun install      # Install dependencies
bun run dev      # Dev server → localhost:5173
bun run build    # Production build
bun run serve    # Production server → localhost:3000
```

### Adding a blog post

1. Add a route in `src/routes/`, following `blog.introducing-sticky.tsx`.
2. Add its title, route, excerpt, category, author, and reading time to `src/lib/blog.ts`.
3. Use `BlogArticle` from `src/components/blog/` for the shared article layout. Pass the post's banner through its `banner` prop.
4. Add any new cover artwork to the card rendering in `src/routes/blog.index.tsx`.
5. Run `bun run build` to regenerate the route tree and check the production build.

Blog styles live in `src/styles/blog.css`. Keep banners proportional and contained within the article width.
