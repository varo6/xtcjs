import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ThemeToggle } from '../ThemeToggle'
import '../../styles/blog.css'

export function BlogLayout({ children, theme, onToggleTheme }: {
  children: ReactNode
  theme: string
  onToggleTheme: () => void
}) {
  return (
    <div className="journal">
      <a className="journal-skip" href="#blog-content">Skip to content</a>
      <header className="journal-masthead">
        <Link to="/blog" className="journal-brand" aria-label="XTC.js blog">
          XTC<span>.</span>js <span className="journal-brand-label">/ Blog</span>
        </Link>
        <nav className="journal-nav" aria-label="Blog navigation">
          <Link to="/">Open converter <span aria-hidden="true">↗</span></Link>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </nav>
      </header>
      <main id="blog-content" className="journal-main">{children}</main>
      <footer className="journal-footer">
        <span>XTC.js · For your reader.</span>
        <div>
          <Link to="/blog">All posts</Link>
          <a href="https://github.com/varo6/xtcjs" target="_blank" rel="noopener">GitHub ↗</a>
        </div>
      </footer>
    </div>
  )
}
