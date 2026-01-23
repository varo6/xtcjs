import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/about')({
  component: AboutPage,
})

function AboutPage() {
  return (
    <div className="about-page">
      <section className="content-section">
        <h1>About XTC.js</h1>
        <p>
          XTC.js is a free, browser-based converter that transforms your CBZ comic archives and PDF documents
          into XTC format, optimized for the <strong>XTEink X4 e-reader</strong>. 
          It runs entirely in your browser — your files never leave your device, ensuring complete privacy.
        </p>
      </section>

      <section className="content-section">
        <h2>Features</h2>
        <ul className="feature-list">
          <li><strong>Privacy-first:</strong> All processing happens locally in your browser. No uploads, no servers, no tracking.</li>
          <li><strong>Multiple formats:</strong> Convert CBZ (manga/comics) and PDF documents to XTC.</li>
          <li><strong>Dithering options:</strong> Choose from Floyd-Steinberg, Atkinson, Sierra-Lite, Ordered, or no dithering for optimal e-ink display.</li>
          <li><strong>Contrast adjustment:</strong> Fine-tune contrast levels for better readability on e-ink screens.</li>
          <li><strong>Smart splitting:</strong> Automatically splits landscape pages for portrait e-reader displays.</li>
          <li><strong>Instant preview:</strong> See how your pages will look before downloading.</li>
          <li><strong>Batch processing:</strong> Convert multiple files at once.</li>
        </ul>
      </section>

      <section className="content-section">
        <h2>How It Works</h2>
        <ol className="steps-list">
          <li><strong>Select files:</strong> Drag and drop your CBZ or PDF files, or click to browse.</li>
          <li><strong>Adjust settings:</strong> Choose your preferred dithering algorithm and contrast level.</li>
          <li><strong>Convert:</strong> Click the convert button and watch the real-time preview.</li>
          <li><strong>Download:</strong> Save your XTC files and transfer them to your XTEink X4.</li>
        </ol>
      </section>

      <section className="content-section">
        <h2>About the XTC Format</h2>
        <p>
          XTC is the native format for the XTEink X4 e-reader. It contains optimized 1-bit (black and white)
          images at 480×800 resolution, specifically designed for e-ink displays. The format uses efficient
          compression to minimize file size while maintaining excellent readability for manga, comics, and documents.
        </p>
      </section>

      <section className="content-section">
        <h2>Frequently Asked Questions</h2>
        <details className="faq-item">
          <summary>Is my data safe?</summary>
          <p>Yes. XTC.js processes everything in your browser using JavaScript. Your files are never uploaded to any server. You can even use this tool offline once the page is loaded.</p>
        </details>
        <details className="faq-item">
          <summary>What dithering algorithm should I use?</summary>
          <p>For manga and comics with lots of screentones, <strong>Atkinson</strong> or <strong>Floyd-Steinberg</strong> work best. For PDFs and text-heavy documents, <strong>Atkinson</strong> with higher contrast is recommended.</p>
        </details>
        <details className="faq-item">
          <summary>Why are my pages split in half?</summary>
          <p>The XTEink X4 has a portrait display (480×800). When you upload a landscape image (like a two-page spread), XTC.js automatically splits it into two pages for optimal reading.</p>
        </details>
        <details className="faq-item">
          <summary>Can I use this on mobile?</summary>
          <p>Yes! XTC.js works on any modern browser, including mobile devices. However, converting large files may be slower on phones due to limited processing power.</p>
        </details>
      </section>

      <section className="content-section">
        <h2>Privacy Policy</h2>
        <p>
          XTC.js does not collect, store, or transmit any personal data. All file processing occurs locally
          in your browser. No cookies are used for tracking. Google AdSense may use cookies for ad
          personalization — see Google's privacy policy for details.
        </p>
      </section>
    </div>
  )
}
