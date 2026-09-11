import { createRootRoute, Outlet, Link, useLocation } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { BlogLayout } from '../components/blog/BlogLayout'
import { ThemeToggle } from '../components/ThemeToggle'
import { MangaSearch } from '../components/MangaSearch'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const location = useLocation()
  const [searchOpen, setSearchOpen] = useState(false)
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'
  })
  const isExtraRoute = location.pathname === '/image' || location.pathname === '/video' || location.pathname === '/metadata'
  const [extraOpen, setExtraOpen] = useState(isExtraRoute)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    if (isExtraRoute) {
      setExtraOpen(true)
    }
  }, [isExtraRoute])

  if (location.pathname === '/blog' || location.pathname.startsWith('/blog/')) {
    return (
      <BlogLayout theme={theme} onToggleTheme={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}>
        <Outlet />
      </BlogLayout>
    )
  }

  return (
    <>
      <div className="grain" />
      <main className="layout">
        <header className="header">
          <div className="logo">
            <span className="logo-xtc">XTC</span>
            <span className="logo-dot">.</span>
            <span className="logo-js">js</span>
          </div>
          <div className="header-actions">
            <Link to="/blog" className="blog-link" activeProps={{ 'aria-current': 'page' }}>
              Blog
            </Link>
            <ThemeToggle theme={theme} onToggle={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')} />
            <button
              type="button"
              className="manga-search-trigger"
              onClick={() => setSearchOpen(true)}
              aria-label="Search manga"
              title="Search manga on nyaa.si"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          </div>
          <p className="tagline">
            XTC tools for your reader · Support by starring on{' '}
            <a
              href="https://github.com/varo6/xtcjs"
              target="_blank"
              rel="noopener"
              style={{ color: 'inherit' }}
            >
              GitHub
            </a>{' '}
            ♥
          </p>
          {location.pathname === '/' && (
            <Link to="/blog/introducing-sticky" className="sticky-announcement">
              <span className="announcement-badge">New</span>
              <span>Sticky support</span>
              <span className="announcement-detail">Meet reTerminal Sticky</span>
              <span aria-hidden="true">↗</span>
            </Link>
          )}
        </header>

        <div className="nav-stack">
          <nav className="nav-tabs">
            <Link to="/" className={`nav-tab${location.pathname === '/' ? ' active' : ''}`}>
              Manga / Comics
            </Link>
            <Link to="/pdf" className={`nav-tab${location.pathname === '/pdf' ? ' active' : ''}`}>
              PDF
            </Link>
            <Link to="/merge" className={`nav-tab${location.pathname === '/merge' ? ' active' : ''}`}>
              Merge / Split
            </Link>
            <button
              type="button"
              className={`nav-tab nav-tab-button${extraOpen || isExtraRoute ? ' active' : ''}`}
              onClick={() => setExtraOpen((prev) => !prev)}
              aria-expanded={extraOpen}
              aria-controls="extra-tools-nav"
            >
              Extra <span className="nav-caret" aria-hidden="true">▼</span>
            </button>
          </nav>

          {extraOpen && (
            <nav id="extra-tools-nav" className="nav-subtabs" aria-label="Extra tools">
              <Link to="/image" className={`nav-subtab${location.pathname === '/image' ? ' active' : ''}`}>
                Image
              </Link>
              <Link to="/video" className={`nav-subtab${location.pathname === '/video' ? ' active' : ''}`}>
                Video
              </Link>
              <Link to="/metadata" className={`nav-subtab${location.pathname === '/metadata' ? ' active' : ''}`}>
                Metadata
              </Link>
            </nav>
          )}
        </div>

        <Outlet />

        <footer className="footer">
          <p>All processing happens in your browser · Your files never leave your device</p>
          <div className="footer-links">
            <a href="https://github.com/varo6/xtcjs" target="_blank" rel="noopener">GitHub</a>
            <span>·</span>
            <Link to="/about">About</Link>
            <span>·</span>
            <a href="https://github.com/tazua/cbz2xtc" target="_blank" rel="noopener">Based on cbz2xtc</a>
          </div>
        </footer>
      </main>
      <MangaSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  )
}
