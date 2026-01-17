interface ProgressProps {
  visible: boolean
  progress: number
  text: string
  previewUrl: string | null
}

export function Progress({ visible, progress, text, previewUrl }: ProgressProps) {
  if (!visible) {
    return null
  }

  const percent = Math.round(progress * 100)

  return (
    <section className="progress-section">
      <div className="progress-header">
        <span className="progress-text">{text}</span>
        <span className="progress-percent">{percent}%</span>
      </div>
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${percent}%` }}
        />
      </div>
      {previewUrl && (
        <div className="preview-container">
          <img src={previewUrl} alt="Preview" />
        </div>
      )}
    </section>
  )
}
