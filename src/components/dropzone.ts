// Dropzone component - handles file drop and selection

import { $ } from '../utils/dom';

export type FileHandler = (files: FileList) => void;

export function initDropzone(onFiles: FileHandler): void {
  const dropzone = $('dropzone');
  const fileInput = $('fileInput') as HTMLInputElement;

  // Click to browse
  dropzone.addEventListener('click', () => fileInput.click());

  // Keyboard accessibility
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  // Drag and drop
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer?.files) {
      onFiles(e.dataTransfer.files);
    }
  });

  // File input change
  fileInput.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.files) {
      onFiles(input.files);
    }
  });
}
