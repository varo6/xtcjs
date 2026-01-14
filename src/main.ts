// Main client-side entry point
// CBZ to XTC Converter - Browser-based conversion

import './styles/main.css';
import './styles/components.css';
import './styles/animations.css';

import { $ } from './utils/dom';
import { initDropzone } from './components/dropzone';
import { updateFileList } from './components/file-list';
import { getOptions } from './components/options';
import { showProgress, hideProgress, updateProgress, setPreviewImage, clearPreview } from './components/progress';
import { showResults, hideResults, downloadResult } from './components/results';
import { initViewer, openViewer } from './components/viewer';
import { convertCbzToXtc, type ConversionResult } from './lib/converter';

// State
let selectedFiles: File[] = [];
let results: ConversionResult[] = [];

// Initialize app
function init(): void {
  // Initialize dropzone with file handler
  initDropzone(handleFiles);

  // Initialize viewer
  initViewer();

  // Convert button
  const convertBtn = $('convertBtn');
  convertBtn.addEventListener('click', startConversion);
}

function handleFiles(files: FileList): void {
  const cbzFiles = Array.from(files).filter(f =>
    f.name.toLowerCase().endsWith('.cbz')
  );

  if (cbzFiles.length === 0) {
    alert('Please select CBZ files');
    return;
  }

  selectedFiles = [...selectedFiles, ...cbzFiles];
  refreshFileList();
}

function refreshFileList(): void {
  updateFileList(selectedFiles, (index) => {
    selectedFiles.splice(index, 1);
    refreshFileList();
  });
}

async function startConversion(): Promise<void> {
  if (selectedFiles.length === 0) return;

  const options = getOptions();
  const convertBtn = $('convertBtn') as HTMLButtonElement;

  convertBtn.disabled = true;
  convertBtn.classList.add('loading');
  showProgress();
  hideResults();
  results = [];

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    updateProgress(i / selectedFiles.length, file.name);

    try {
      const result = await convertCbzToXtc(file, options, (pageProgress, previewUrl) => {
        updateProgress((i + pageProgress) / selectedFiles.length);
        setPreviewImage(previewUrl);
      });
      results.push(result);
    } catch (err) {
      console.error(`Error converting ${file.name}:`, err);
      results.push({
        name: file.name.replace('.cbz', '.xtc'),
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  }

  updateProgress(1, 'Complete');
  hideProgress();
  clearPreview();
  convertBtn.disabled = false;
  convertBtn.classList.remove('loading');

  showResults(
    results,
    downloadResult,
    (result) => {
      if (result.pageImages) {
        openViewer(result.pageImages);
      }
    }
  );
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
