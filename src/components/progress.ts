// Progress component - conversion progress display

import { $ } from '../utils/dom';

export function showProgress(): void {
  const progressSection = $('progress');
  progressSection.classList.remove('hidden');
  progressSection.classList.add('processing');
}

export function hideProgress(): void {
  const progressSection = $('progress');
  progressSection.classList.remove('processing');
}

export function updateProgress(ratio: number, text?: string): void {
  const progressBar = $('progressBar');
  const progressPercent = $('progressPercent');
  const progressText = $('progressText');

  const percent = Math.round(ratio * 100);
  progressBar.style.width = `${percent}%`;
  progressPercent.textContent = `${percent}%`;

  if (text !== undefined) {
    progressText.textContent = text;
  }
}

export function setPreviewImage(url: string | null): void {
  const currentPage = $('currentPage');
  if (url) {
    currentPage.innerHTML = `<img src="${url}" alt="Preview">`;
  } else {
    currentPage.innerHTML = '';
  }
}

export function clearPreview(): void {
  const currentPage = $('currentPage');
  currentPage.innerHTML = '';
}
