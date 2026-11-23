/** The icons of the capsule of tools (the same drawings as the ones of `@nota-adoc/react`, which does not export them). */
import type { ReactElement } from 'react'

const svg = (children: ReactElement | ReactElement[], size = 16): ReactElement => (
  <svg
    viewBox="0 0 16 16"
    width={size}
    height={size}
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
)

export const PlusIcon = (): ReactElement => svg(<path d="M8 3v10M3 8h10" />)
export const ChevronIcon = (): ReactElement => svg(<path d="M4 6l4 4 4-4" />, 11)
export const CodeIcon = (): ReactElement => svg(<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />)
export const DotsIcon = (): ReactElement =>
  svg(
    <>
      <circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none" />
    </>,
  )
export const LinkIcon = (): ReactElement =>
  svg(
    <>
      <path d="M6.6 9.4l2.8-2.8" />
      <path d="M7.3 4.6l.9-.9a2.7 2.7 0 013.9 3.9l-.9.9" />
      <path d="M8.7 11.4l-.9.9a2.7 2.7 0 01-3.9-3.9l.9-.9" />
    </>,
  )
export const BulletListIcon = (): ReactElement =>
  svg(
    <>
      <circle cx="3" cy="4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="3" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="3" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <path d="M6.5 4h7M6.5 8h7M6.5 12h7" />
    </>,
  )
export const NumberListIcon = (): ReactElement =>
  svg(
    <>
      <path d="M2.2 3.2l1-.6v3M2 9.6c.2-.7 1.7-.8 1.7.1 0 .7-1.7 1.3-1.7 2.2h1.8" />
      <path d="M6.5 4h7M6.5 8h7M6.5 12h7" />
    </>,
  )
export const CheckListIcon = (): ReactElement =>
  svg(
    <>
      <path d="M1.8 3.4l1 1 1.7-1.9M1.8 9.4l1 1 1.7-1.9" />
      <path d="M7 4h6.5M7 10h6.5" />
    </>,
  )

/** the drawings of the blocks of «+» (the lists above are the same as in the capsule). */
export const HeadingGlyph = ({ level }: { level: 2 | 3 | 4 | 5 | 6 }): ReactElement => <span className="bl-glyph">{`H${level}`}</span>
export const TableIcon = (): ReactElement =>
  svg(
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M2 10h12M6.5 2.5v11" />
    </>,
  )
export const MermaidIcon = (): ReactElement =>
  svg(
    <>
      <rect x="1.5" y="2" width="5" height="4" rx="1" />
      <rect x="9.5" y="10" width="5" height="4" rx="1" />
      <path d="M4 6v3.5a1 1 0 001 1h4.5" />
    </>,
  )
export const AdmonitionIcon = (): ReactElement =>
  svg(
    <>
      <path d="M8 2l6.5 11.5h-13z" />
      <path d="M8 6.5v3.2M8 11.6v.2" />
    </>,
  )
export const CollapsibleIcon = (): ReactElement =>
  svg(
    <>
      <path d="M3 5l2 2 2-2" />
      <path d="M9 6h5M3 10h11M3 13h8" />
    </>,
  )
export const ImageIcon = (): ReactElement =>
  svg(
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.2" />
      <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" />
    </>,
  )
