// CBZ to XTC conversion logic

import { applyDithering } from './processing/dithering';
import { toGrayscale, applyContrast, calculateOverlapSegments } from './processing/image';
import { rotateCanvas, extractAndRotate, resizeWithPadding, TARGET_WIDTH, TARGET_HEIGHT } from './processing/canvas';
import { buildXtc } from './xtc-format';

// Declare JSZip global (loaded from CDN)
declare const JSZip: any;

export interface ConversionOptions {
  splitMode: string;
  dithering: string;
  contrast: number;
  margin: number;
}

export interface ConversionResult {
  name: string;
  data?: ArrayBuffer;
  size?: number;
  pageCount?: number;
  pageImages?: string[];
  error?: string;
}

interface ProcessedPage {
  name: string;
  canvas: HTMLCanvasElement;
}

/**
 * Convert a CBZ file to XTC format
 */
export async function convertCbzToXtc(
  file: File,
  options: ConversionOptions,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<ConversionResult> {
  const zip = await JSZip.loadAsync(file);

  const imageFiles: Array<{ path: string; entry: any }> = [];
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

  zip.forEach((relativePath: string, zipEntry: any) => {
    if (zipEntry.dir) return;
    if (relativePath.toLowerCase().startsWith('__macos')) return;

    const ext = relativePath.toLowerCase().substring(relativePath.lastIndexOf('.'));
    if (imageExtensions.includes(ext)) {
      imageFiles.push({ path: relativePath, entry: zipEntry });
    }
  });

  imageFiles.sort((a, b) => a.path.localeCompare(b.path));

  if (imageFiles.length === 0) {
    throw new Error('No images found in CBZ');
  }

  const processedPages: ProcessedPage[] = [];

  for (let i = 0; i < imageFiles.length; i++) {
    const imgFile = imageFiles[i];
    const imgBlob = await imgFile.entry.async('blob');

    const pages = await processImage(imgBlob, i + 1, options);
    processedPages.push(...pages);

    if (pages.length > 0 && pages[0].canvas) {
      const previewUrl = pages[0].canvas.toDataURL('image/png');
      onProgress((i + 1) / imageFiles.length, previewUrl);
    } else {
      onProgress((i + 1) / imageFiles.length, null);
    }
  }

  processedPages.sort((a, b) => a.name.localeCompare(b.name));

  // Store page images for viewer
  const pageImages = processedPages.map(page => page.canvas.toDataURL('image/png'));

  const xtcData = await buildXtc(processedPages);

  return {
    name: file.name.replace(/\.cbz$/i, '.xtc'),
    data: xtcData,
    size: xtcData.byteLength,
    pageCount: processedPages.length,
    pageImages
  };
}

/**
 * Process a single image from the CBZ
 */
async function processImage(
  imgBlob: Blob,
  pageNum: number,
  options: ConversionOptions
): Promise<ProcessedPage[]> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(imgBlob);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const pages = processLoadedImage(img, pageNum, options);
      resolve(pages);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      console.error(`Failed to load image for page ${pageNum}`);
      resolve([]);
    };
    img.src = objectUrl;
  });
}

/**
 * Process a loaded image element
 */
function processLoadedImage(
  img: HTMLImageElement,
  pageNum: number,
  options: ConversionOptions
): ProcessedPage[] {
  const results: ProcessedPage[] = [];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  let width = img.width;
  let height = img.height;

  // Apply margin crop if configured
  if (options.margin > 0) {
    const marginPx = {
      left: Math.floor(width * options.margin / 100),
      top: Math.floor(height * options.margin / 100),
      right: Math.floor(width * options.margin / 100),
      bottom: Math.floor(height * options.margin / 100)
    };

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = width - marginPx.left - marginPx.right;
    croppedCanvas.height = height - marginPx.top - marginPx.bottom;
    const croppedCtx = croppedCanvas.getContext('2d')!;

    croppedCtx.drawImage(
      img,
      marginPx.left, marginPx.top,
      croppedCanvas.width, croppedCanvas.height,
      0, 0,
      croppedCanvas.width, croppedCanvas.height
    );

    width = croppedCanvas.width;
    height = croppedCanvas.height;

    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(croppedCanvas, 0, 0);
  } else {
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0);
  }

  // Apply contrast enhancement
  if (options.contrast > 0) {
    applyContrast(ctx, width, height, options.contrast);
  }

  // Convert to grayscale
  toGrayscale(ctx, width, height);

  const shouldSplit = width < height && options.splitMode !== 'nosplit';

  if (shouldSplit) {
    if (options.splitMode === 'overlap') {
      // Overlapping thirds
      const segments = calculateOverlapSegments(width, height);
      segments.forEach((seg, idx) => {
        const letter = String.fromCharCode(97 + idx);
        const pageCanvas = extractAndRotate(canvas, seg.x, seg.y, seg.w, seg.h);
        const finalCanvas = resizeWithPadding(pageCanvas);
        applyDithering(finalCanvas.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering);

        results.push({
          name: `${String(pageNum).padStart(4, '0')}_3_${letter}.png`,
          canvas: finalCanvas
        });
      });
    } else {
      // Split in half
      const halfHeight = Math.floor(height / 2);

      const topCanvas = extractAndRotate(canvas, 0, 0, width, halfHeight);
      const topFinal = resizeWithPadding(topCanvas);
      applyDithering(topFinal.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering);
      results.push({
        name: `${String(pageNum).padStart(4, '0')}_2_a.png`,
        canvas: topFinal
      });

      const bottomCanvas = extractAndRotate(canvas, 0, halfHeight, width, halfHeight);
      const bottomFinal = resizeWithPadding(bottomCanvas);
      applyDithering(bottomFinal.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering);
      results.push({
        name: `${String(pageNum).padStart(4, '0')}_2_b.png`,
        canvas: bottomFinal
      });
    }
  } else {
    // No split - full page
    const rotatedCanvas = rotateCanvas(canvas, 90);
    const finalCanvas = resizeWithPadding(rotatedCanvas);
    applyDithering(finalCanvas.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering);

    results.push({
      name: `${String(pageNum).padStart(4, '0')}_0_spread.png`,
      canvas: finalCanvas
    });
  }

  return results;
}
