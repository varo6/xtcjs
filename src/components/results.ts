// Results component - displays conversion results

import { $, escapeHtml } from '../utils/dom';
import { formatSize } from '../utils/format';
import type { ConversionResult } from '../lib/converter';

export function showResults(
  results: ConversionResult[],
  onDownload: (result: ConversionResult) => void,
  onPreview: (result: ConversionResult) => void
): void {
  const resultsSection = $('results');
  const resultsList = $('resultsList');

  resultsSection.classList.remove('hidden');

  resultsList.innerHTML = results.map((result, idx) => {
    if (result.error) {
      return `
        <div class="result-item error">
          <div>
            <span class="name">${escapeHtml(result.name)}</span>
            <div class="info">Error: ${escapeHtml(result.error)}</div>
          </div>
        </div>
      `;
    }
    return `
      <div class="result-item">
        <div>
          <span class="name">${escapeHtml(result.name)}</span>
          <div class="info">${result.pageCount} pages &middot; ${formatSize(result.size || 0)}</div>
        </div>
        <div class="result-actions">
          <button class="btn-preview" data-idx="${idx}">Preview</button>
          <button class="btn-download" data-idx="${idx}">Download</button>
        </div>
      </div>
    `;
  }).join('');

  resultsList.querySelectorAll('.btn-download').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const idx = parseInt(target.dataset.idx || '0');
      onDownload(results[idx]);
    });
  });

  resultsList.querySelectorAll('.btn-preview').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const idx = parseInt(target.dataset.idx || '0');
      onPreview(results[idx]);
    });
  });
}

export function hideResults(): void {
  const resultsSection = $('results');
  resultsSection.classList.add('hidden');
}

export function downloadResult(result: ConversionResult): void {
  if (!result.data) return;

  const blob = new Blob([result.data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
