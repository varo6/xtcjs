// Options component - conversion settings

import { $ } from '../utils/dom';
import type { ConversionOptions } from '../lib/converter';

export function getOptions(): ConversionOptions {
  const splitModeSelect = $('splitMode') as HTMLSelectElement;
  const ditheringSelect = $('dithering') as HTMLSelectElement;
  const contrastSelect = $('contrast') as HTMLSelectElement;
  const marginInput = $('margin') as HTMLInputElement;

  return {
    splitMode: splitModeSelect.value,
    dithering: ditheringSelect.value,
    contrast: parseInt(contrastSelect.value),
    margin: parseFloat(marginInput.value)
  };
}
