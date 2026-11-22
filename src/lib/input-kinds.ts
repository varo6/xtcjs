export type InputKind = 'cbz' | 'pdf' | 'image' | 'video' | 'xtc'

const INPUT_KINDS: Record<InputKind, { label: string; extensions: string[] }> = {
  cbz: { label: 'CBZ/CBR', extensions: ['.cbz', '.cbr'] },
  pdf: { label: 'PDF', extensions: ['.pdf'] },
  image: { label: 'Image', extensions: ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'] },
  video: { label: 'Video', extensions: ['.mp4', '.webm', '.mkv', '.avi', '.mov'] },
  xtc: { label: 'XTC/XTCH', extensions: ['.xtc', '.xtch'] },
}

export function acceptsFile(kind: InputKind, fileName: string): boolean {
  const name = fileName.toLowerCase()
  return INPUT_KINDS[kind].extensions.some((extension) => name.endsWith(extension))
}

export function acceptAttribute(kind: InputKind): string {
  return INPUT_KINDS[kind].extensions.join(',')
}

export function inputLabel(kind: InputKind): string {
  return INPUT_KINDS[kind].label
}
