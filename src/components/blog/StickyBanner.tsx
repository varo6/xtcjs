/** A stylized reading illustration, not a hardware product photograph. */
export function StickyBanner() {
  return (
    <div className="sticky-banner" role="img"
      aria-label="reTerminal Sticky × XTC.js. Your next chapter, on Sticky. Illustration of a reader displaying a mountain landscape.">
      <div className="sticky-banner-copy" aria-hidden="true">
        <span className="sticky-banner-eyebrow">A new place to read</span>
        <span className="sticky-banner-partners">reTerminal Sticky <span>×</span> XTC.js</span>
        <span className="sticky-banner-title">Your next chapter.<br />Now on Sticky.</span>
        <span className="sticky-banner-note">With CrossPoint Reader</span>
      </div>
      <svg className="sticky-banner-art" aria-hidden="true" viewBox="0 0 360 360" fill="none">
        <circle cx="191" cy="181" r="153" stroke="currentColor" strokeOpacity=".18" />
        <circle cx="191" cy="181" r="126" stroke="currentColor" strokeOpacity=".12" />
        <g transform="rotate(9 190 180)">
          <rect x="98" y="38" width="196" height="290" rx="19" fill="#132b27" opacity=".15" />
          <rect x="86" y="26" width="196" height="290" rx="19" fill="#e5e6d8" stroke="#193a32" strokeWidth="2" />
          <rect x="98" y="39" width="172" height="250" rx="8" fill="#243d35" />
          <rect x="105" y="46" width="158" height="236" rx="3" fill="#f5f0de" />
          <path d="M115 63h48m-48 6h30" stroke="#243d35" strokeWidth="2" />
          <circle cx="225" cy="111" r="19" fill="#243d35" />
          <path d="m105 190 51-80 58 91 23-38 26 44v33H105Z" fill="#8a9882" />
          <path d="m105 215 43-51 43 40 26-18 46 46v24H105Z" fill="#243d35" />
          <path d="m140 135 16-25 20 32-18-11-8 10Z" fill="#f5f0de" />
          <path d="M116 263h97m-97 7h67" stroke="#243d35" strokeWidth="2" />
          <circle cx="184" cy="303" r="3" fill="#243d35" />
        </g>
        <path d="M55 99h18m-9-9v18M307 260h14m-7-7v14" stroke="currentColor" strokeWidth="2" />
      </svg>
    </div>
  )
}
