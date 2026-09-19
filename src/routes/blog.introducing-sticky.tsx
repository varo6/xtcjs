import { createFileRoute, Link } from '@tanstack/react-router'
import { BlogArticle } from '../components/blog/BlogArticle'
import { StickyBanner } from '../components/blog/StickyBanner'
import { stickyPost } from '../lib/blog'
import { InfoNote } from '../components/InfoNote'

export const Route = createFileRoute('/blog/introducing-sticky')({
  component: StickyPost,
})

function StickyPost() {
  return (
    <BlogArticle post={stickyPost} banner={<StickyBanner />}>
      <section>
        <h2>For your reader</h2>
        <p>
          XTC.js started as a tool for XTEink readers. Adding Sticky is a step toward an app
          that works across more devices. You'll see us say "your reader" more often around
          the site as we make that change.
        </p>
        <p>
          XTEink X4, X4 Pro, and X3 are still supported. Pick your reader in the device
          selector and XTC.js will use the matching page size. Conversion still happens
          in your browser, with no file uploads.
        </p>
      </section>
      <section>
        <h2>Using reTerminal Sticky</h2>
        <InfoNote>
          Sticky requires CrossPoint Reader firmware. The XTC files created here are
          not compatible with the original Seeed firmware.
        </InfoNote>
        <ol>
          <li>Install CrossPoint Reader on your reTerminal Sticky.</li>
          <li>Open a converter and select Sticky in the device selector.</li>
          <li>Add your files and adjust the preview to your liking.</li>
          <li>Convert, download, and transfer the XTC files to your reader.</li>
        </ol>
        <p>
          The Sticky preset uses a 480×800 page canvas for CrossPoint Reader.
          Dithering, contrast, and page splitting work just as they do with the other reader presets.
        </p>
      </section>
      <section>
        <h2>Thank you, Seeed Studio</h2>
        <p>
          A big thank you to the <a href="https://www.seeedstudio.com/sticky/">Seeed Studio team behind reTerminal Sticky</a>.
          We're happy to bring Sticky to XTC.js, and we hope to keep working with you
          to make reading on it even better.
        </p>
        <Link to="/" className="journal-cta">Convert for your reader →</Link>
      </section>
    </BlogArticle>
  )
}
