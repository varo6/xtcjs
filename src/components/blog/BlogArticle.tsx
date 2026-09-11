import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { blogPosts } from '../../lib/blog'

export function BlogArticle({ post, banner, children }: {
  post: (typeof blogPosts)[number]
  banner: ReactNode
  children: ReactNode
}) {
  return (
    <article className="journal-article">
      <header className="journal-article-header">
        <Link to="/blog" className="journal-back">← All posts</Link>
        <p className="journal-eyebrow">{post.category}</p>
        <h1>{post.title}</h1>
        <p className="journal-deck">{post.excerpt}</p>
        <p className="journal-byline">{post.author}<span aria-hidden="true">·</span>{post.readingTime}</p>
      </header>
      {banner}
      <div className="journal-prose">{children}</div>
    </article>
  )
}
