import { createRootRoute, Outlet, Link, useLocation } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const location = useLocation()

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
          <Link to="/feature3" className={`nav-tab${location.pathname === '/feature3' ? ' active' : ''}`}>
            Soon
          </Link>
        </nav>

        <Outlet />

        <footer className="footer">
          <p>All processing happens in your browser</p>
          <a href="https://github.com/tazua/cbz2xtc" target="_blank" rel="noopener">
            Based on cbz2xtc
          </a>
        </footer>
      </main>
    </>
  )
}
