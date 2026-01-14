// File list component - displays selected files

import { $, escapeHtml } from '../utils/dom';
import { formatSize } from '../utils/format';

export function updateFileList(
  files: File[],
  onRemove: (index: number) => void
): void {
  const fileListSection = $('fileList');
  const filesContainer = $('files');
  const fileCount = $('fileCount');

  if (files.length === 0) {
    fileListSection.classList.add('hidden');
    return;
  }

  fileListSection.classList.remove('hidden');
  fileCount.textContent = String(files.length);

  filesContainer.innerHTML = files.map((file, idx) => `
    <div class="file-item">
      <span class="name">${escapeHtml(file.name)}</span>
      <span class="size">${formatSize(file.size)}</span>
      <button class="remove" data-idx="${idx}" aria-label="Remove file">&times;</button>
    </div>
  `).join('');

  filesContainer.querySelectorAll('.remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const idx = parseInt(target.dataset.idx || '0');
      onRemove(idx);
    });
  });
}
