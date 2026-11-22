# Optimal Default Settings — Benchmark Findings

Results from a parameter sweep across 51 titles (13 manga, 38 western comics) testing every combination of dithering, contrast, gamma, and sharpening. Scored using math metrics (SSIM, entropy, edge density, histogram spread) and CLIP perceptual scoring. Findings are segregated by content type because manga and western comics have different optimal settings.

## Recommended Defaults

| Parameter | Default | Notes |
|-----------|---------|-------|
| Dithering | Atkinson | Best for 10/16 unique titles. Floyd-Steinberg better for painted/color art. |
| Contrast | Light (level 2) | Compromise default. Manga prefers Normal; western comics prefer Light/Off. |
| Gamma | 1.0 | Correct across both cohorts. No adjustment needed. |
| Sharpen | Normal (0.7) | Best for most content. Turn off for very fine crosshatching. |
| Denoise | Off | Usually degrades quality. Only helps poor-quality scans with visible speckles. |

## Dithering

**Atkinson** won 10 of 16 unique titles (63%) in composite scoring. It produces high-contrast dot patterns that read well on e-ink, especially for line art and manga.

**Floyd-Steinberg** won the remaining 6, and is the better choice for:
- Painted art (Sandman)
- Color-heavy manga (Chainsaw Man)
- Titles with lots of gradients and tonal variation

**Sierra Lite** didn't win any title outright but scored close to Atkinson on several. It's a viable middle ground.

**Recommendation:** Default to Atkinson. Offer Floyd-Steinberg as the alternative for painted/color art.

## Contrast — The Sharpest Manga/Western Split

This is where content type matters most:

| Cohort | Off | Light | Normal | 
|--------|-----|-------|--------|
| Manga (13 titles) | 15% | 15% | **69%** |
| Western (38 titles) | 43% | **35%** | 22% |

Manga strongly prefers Normal contrast — the heavier boost makes black lines pop on e-ink. Western comics (especially color comics converted to grayscale) prefer Light or Off — too much contrast crushes the tonal range.

**Warning:** Naive aggregation across all 51 titles gives "Light won 17/51" which is misleading — 16 of those 17 were Civil War issues (same publisher, same era, same color palette). Always segregate by content type.

## Gamma

1.0 is correct for both cohorts. Neither manga nor western comics benefit from gamma adjustment as a default. Users should only adjust gamma if their specific scans look too dark or washed out.

## Sharpening

Normal (0.7) is optimal for most content. The only case to turn it off is very fine crosshatching (e.g., detailed European comics) where sharpening can create shimmer/moiré artifacts.

## Denoise

Off by default. Denoise (non-local means) smooths texture that's usually intentional. It only helps for genuinely poor scans with visible speckle noise in white areas. Turning it on for clean scans makes artwork look soft and blurry.

## Methodology

- **Corpus:** 51 titles — 13 manga (One Punch Man, Vagabond, Berserk, Punpun, Chainsaw Man, etc.), 38 western (35 Civil War issues, Riddler, Spider-Man, Sandman)
- **Parameters swept:** 3 dithering algorithms × 3 contrast levels × 3 gamma values × 3 sharpen levels = 81 combinations per title
- **Pass 1 (math):** SSIM vs reference, Shannon entropy, Sobel edge density, histogram spread
- **Pass 2 (CLIP):** Perceptual scoring using local CLIP model — positive prompts ("a well-reproduced comic book page", "a crisp readable manga page") vs negative prompts ("a blurry page", "a noisy page", "a washed out page"). 25% weight in composite score.
- **Analysis:** Cohort-segregated (manga vs western) to prevent corpus bias from skewing recommendations

## For xtcjs Users

If you're converting manga: Atkinson dithering + Normal contrast will give you the best results out of the box.

If you're converting western/color comics: try Floyd-Steinberg dithering + Light contrast (or Off contrast for very colorful art).

These findings come from the [comic-book-panel-converter](https://github.com/terriblyoffendedmarketer-stack/comic-book-panel-converter) project, which uses the same overlap segment algorithm as xtcjs.
