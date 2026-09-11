import { createFileRoute, Link } from '@tanstack/react-router'
import { StickyBanner } from '../components/blog/StickyBanner'
import { blogPosts } from '../lib/blog'

export const Route = createFileRoute('/blog/')({
  component: BlogPage,
})

function BlogPage() {
  return (
    <div className="journal-index">
      <header className="journal-index-header">
        <p className="journal-eyebrow">The XTC.js blog</p>
        <h1>Notes for your<br /><em>next chapter.</em></h1>
        <p>New readers, app updates, and things we're working on.</p>
      </header>
      <div className="journal-section-label"><h2>Latest stories</h2><span>{String(blogPosts.length).padStart(2, '0')}</span></div>
      <div className="journal-posts">
        {blogPosts.map(post => (
          <article className="journal-card" key={post.slug}>
            <Link to={post.to} className="journal-card-cover" aria-label={post.title}>
              {post.cover === 'sticky' && <StickyBanner />}
            </Link>
            <div className="journal-card-copy">
              <p className="journal-eyebrow">{post.category}<span>·</span>{post.readingTime}</p>
              <h2><Link to={post.to}>{post.title}</Link></h2>
              <p>{post.excerpt}</p>
              <Link to={post.to} className="journal-read">Read the story <span aria-hidden="true">↗</span></Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
