import type { ConversionOptions } from '../lib/converter'

interface OptionsProps {
  options: ConversionOptions
  onChange: (options: ConversionOptions) => void
}

export function Options({ options, onChange }: OptionsProps) {
  return (
    <aside className="options-panel">
      <div className="section-header">
        <h2>Options</h2>
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
        <>
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

          <div className="option">
            <label htmlFor="splitMode">Page Split</label>
            <select
              id="splitMode"
              value={options.splitMode}
              onChange={(e) => onChange({ ...options, splitMode: e.target.value })}
            >
              <option value="overlap">Overlapping thirds</option>
              <option value="split">Split in half</option>
              <option value="nosplit">No split</option>
            </select>
          </div>
        </>
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

      <div className="option">
        <label htmlFor="contrast">Contrast</label>
        <select
          id="contrast"
          value={options.contrast}
          onChange={(e) => onChange({ ...options, contrast: parseInt(e.target.value) })}
        >
          <option value="0">None</option>
          <option value="2">Light</option>
          <option value="4">Medium</option>
          <option value="6">Strong</option>
          <option value="8">Maximum</option>
        </select>
      </div>

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
    </aside>
  )
}
