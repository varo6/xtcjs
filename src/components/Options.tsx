import { useState } from 'react'
import type { ConversionOptions } from '../lib/converter'

interface OptionsProps {
  options: ConversionOptions
  onChange: (options: ConversionOptions) => void
  fileType?: 'cbz' | 'pdf' | 'image' | 'video'
}

export function Options({ options, onChange, fileType = 'cbz' }: OptionsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const isImageMode = fileType === 'image'
  const isVideoMode = fileType === 'video'
  const supportsSplit = !isImageMode && !isVideoMode && options.orientation === 'landscape'
  const showPageOverview = supportsSplit &&
    options.splitMode !== 'nosplit' &&
    (fileType === 'cbz' || fileType === 'pdf')

  return (
    <div className="options-stack">
      <aside className="device-panel">
        <div className="section-header">
          <h2>Target Device</h2>
        </div>

        <div className="device-control">
          <div className="device-toggle" role="group" aria-label="Target device">
            <button
              type="button"
              className={options.device === 'X4' ? 'active' : ''}
              aria-pressed={options.device === 'X4'}
              onClick={() => onChange({ ...options, device: 'X4' })}
              title="XTEink X4 (480 x 800)"
            >
              [X4]
            </button>
            <button
              type="button"
              className={options.device === 'X3' ? 'active' : ''}
              aria-pressed={options.device === 'X3'}
              onClick={() => onChange({ ...options, device: 'X3' })}
              title="XTEink X3 (528 x 792)"
            >
              [X3]
            </button>
          </div>
          {options.device === 'X3' && (
            <p className="device-warning">WARNING: Select only if you are using the X3 device.</p>
          )}
        </div>
      </aside>

      <aside className="options-panel">
        <div className="section-header">
          <h2>Basic Settings</h2>
        </div>

        <div className="option">
          <label htmlFor="orientation">Orientation</label>
          <select
            id="orientation"
            value={options.orientation}
            onChange={(e) => onChange({ ...options, orientation: e.target.value as 'landscape' | 'portrait' })}
          >
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
          </select>
        </div>

        {options.orientation === 'landscape' && (
          <div className="option option-checkbox">
            <label htmlFor="landscapeFlipClockwise" className="checkbox-label">
              <input
                type="checkbox"
                id="landscapeFlipClockwise"
                checked={options.landscapeFlipClockwise}
                onChange={(e) => onChange({ ...options, landscapeFlipClockwise: e.target.checked })}
              />
              <span>Flip landscape clockwise</span>
            </label>
          </div>
        )}

        {(isImageMode || isVideoMode) && (
          <div className="option">
            <label htmlFor="imageMode">Image Scaling</label>
            <select
              id="imageMode"
              value={options.imageMode}
              onChange={(e) => onChange({ ...options, imageMode: e.target.value as ConversionOptions['imageMode'] })}
            >
              <option value="cover">Cover (Fill + Crop)</option>
              <option value="letterbox">Letterbox (Fit + Pad)</option>
              <option value="fill">Fill (Stretch)</option>
              <option value="crop">Center Crop</option>
            </select>
          </div>
        )}

        {isImageMode && (
          <div className="option option-checkbox">
            <label htmlFor="is2bit" className="checkbox-label">
              <input
                type="checkbox"
                id="is2bit"
                checked={options.is2bit}
                onChange={(e) => onChange({ ...options, is2bit: e.target.checked })}
              />
              <span>Use XTCH 2-bit grayscale output</span>
            </label>
          </div>
        )}

        {isVideoMode && (
          <div className="option">
            <label htmlFor="videoFps">Video FPS</label>
            <div className="input-with-unit">
              <input
                type="number"
                id="videoFps"
                min="0.1"
                max="10"
                step="0.1"
                value={options.videoFps}
                onChange={(e) => onChange({ ...options, videoFps: parseFloat(e.target.value) || 1 })}
              />
              <span className="unit">FPS</span>
            </div>
          </div>
        )}

        {supportsSplit && (
          <div className="option">
            <label htmlFor="splitMode">Page Split</label>
            <select
              id="splitMode"
              value={options.splitMode}
              onChange={(e) => onChange({ ...options, splitMode: e.target.value as ConversionOptions['splitMode'] })}
            >
              <option value="overlap">Overlapping thirds</option>
              <option value="split">Split in half</option>
              <option value="nosplit">No split</option>
            </select>
          </div>
        )}

        {showPageOverview && (
          <div className="option">
            <label htmlFor="pageOverview">Page Overview</label>
            <select
              id="pageOverview"
              value={options.pageOverview}
              onChange={(e) => onChange({ ...options, pageOverview: e.target.value as ConversionOptions['pageOverview'] })}
            >
              <option value="none">None</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>
        )}

        <div className="option">
          <label htmlFor="dithering">Dithering</label>
          <select
            id="dithering"
            value={options.dithering}
            onChange={(e) => onChange({ ...options, dithering: e.target.value })}
          >
            <option value="floyd">Floyd-Steinberg</option>
            <option value="atkinson">Atkinson</option>
            <option value="sierra-lite">Sierra Lite</option>
            <option value="ordered">Ordered</option>
            <option value="none">None</option>
          </select>
        </div>

        <div className="options-actions">
          <button
            type="button"
            className="btn-advanced"
            onClick={() => setShowAdvanced(prev => !prev)}
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? 'Hide Advanced Settings' : 'Advanced Settings'}
          </button>
        </div>

        {showAdvanced && (
          <div className="advanced-group">
            <div className="section-header">
              <h2>Advanced</h2>
            </div>

            <div className="option">
              <label htmlFor="contrast">Contrast</label>
              <select
                id="contrast"
                value={options.contrast}
                onChange={(e) => onChange({ ...options, contrast: parseInt(e.target.value, 10) })}
              >
                <option value="0">None</option>
                <option value="2">Light</option>
                <option value="4">Medium</option>
                <option value="6">Strong</option>
                <option value="8">Maximum</option>
              </select>
            </div>

            {!isImageMode && !isVideoMode && (
              <div className="option">
                <label htmlFor="horizontalMargin">Horizontal margin crop</label>
                <div className="input-with-unit">
                  <input
                    type="number"
                    id="horizontalMargin"
                    min="0"
                    max="20"
                    step="0.5"
                    value={options.horizontalMargin}
                    onChange={(e) => onChange({ ...options, horizontalMargin: parseFloat(e.target.value) || 0 })}
                  />
                  <span className="unit">%</span>
                </div>
              </div>
            )}

            {!isImageMode && !isVideoMode && (
              <div className="option">
                <label htmlFor="verticalMargin">Vertical margin crop</label>
                <div className="input-with-unit">
                  <input
                    type="number"
                    id="verticalMargin"
                    min="0"
                    max="20"
                    step="0.5"
                    value={options.verticalMargin}
                    onChange={(e) => onChange({ ...options, verticalMargin: parseFloat(e.target.value) || 0 })}
                  />
                  <span className="unit">%</span>
                </div>
              </div>
            )}

            <div className="option option-checkbox">
              <label htmlFor="showProgressPreview" className="checkbox-label">
                <input
                  type="checkbox"
                  id="showProgressPreview"
                  checked={options.showProgressPreview}
                  onChange={(e) => onChange({ ...options, showProgressPreview: e.target.checked })}
                />
                <span>Show live progress preview</span>
              </label>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
