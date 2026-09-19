import type { ReactNode } from 'react'

export function InfoNote({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p className="info-note" id={id} role="note">
      {children}
    </p>
  )
}
