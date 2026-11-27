import { ArrowUpRight, Handshake } from 'lucide-react'
import type { ReactNode } from 'react'

/* From the tour viewer (viewer-templates-tour, pascal/src/viewer/chrome/BrandHeader.tsx): the
   explore panel's link strip. */

/** One link in the explore panel's strip: an icon whose label slides out on hover or focus. */
function RevealLink({ href, label, icon, primary = false }: { href: string; label: string; icon: ReactNode; primary?: boolean }) {
  return (
    <a
      aria-label={`${label} (opens in a new tab)`}
      className="reveal-link ui-dock-item"
      data-primary={primary || undefined}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      <span aria-hidden="true" className="reveal-link-icon">
        {icon}
      </span>
      <span aria-hidden="true" className="reveal-link-label">
        {label}
      </span>
    </a>
  )
}

function XMark() {
  return (
    <svg aria-hidden="true" fill="currentColor" focusable="false" viewBox="0 0 24 24">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932 6.064-6.933ZM17.61 20.646h2.039L6.487 3.24H4.3L17.61 20.646Z" />
    </svg>
  )
}

/** Get started, Partner with us and Pascal on X, as icons in the explore panel's container. */
export function OutreachLinks() {
  return (
    <span className="flex items-center gap-0.5">
      <RevealLink href="https://editor.pascal.app/" icon={<ArrowUpRight />} label="Get started with Pascal" primary />
      <RevealLink href="https://editor.pascal.app/next" icon={<Handshake />} label="Partner with us" />
      <RevealLink href="https://x.com/pascal" icon={<XMark />} label="Follow @pascal on X" />
    </span>
  )
}
