import { createRootRoute, Outlet, Link, useLocation } from '@tanstack/react-router'
import { useState } from 'react'
import { MangaSearch } from '../components/MangaSearch'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const location = useLocation()
  const [searchOpen, setSearchOpen] = useState(false)

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
          <button
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
          <p className="tagline">
            Optimized XTC Tools for your <em>XTEink X4</em> · Support by starring on{' '}
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
        </header>

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
          <Link to="/feature4" className={`nav-tab${location.pathname === '/feature4' ? ' active' : ''}`}>
            Soon
          </Link>
        </nav>

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
