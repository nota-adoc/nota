import { type ReactElement, useId } from 'react'

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

export const LinkIcon = (): ReactElement =>
  svg(
    <>
      <path d="M6.6 9.4l2.8-2.8" />
      <path d="M7.3 4.6l.9-.9a2.7 2.7 0 013.9 3.9l-.9.9" />
      <path d="M8.7 11.4l-.9.9a2.7 2.7 0 01-3.9-3.9l.9-.9" />
    </>,
  )
export const CodeIcon = (): ReactElement => svg(<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />)
export const UndoIcon = (): ReactElement =>
  svg(
    <>
      <path d="M5.5 3.5L2.5 6.5l3 3" />
      <path d="M2.5 6.5h7.2a3.5 3.5 0 010 7H7.5" />
    </>,
  )
export const RedoIcon = (): ReactElement =>
  svg(
    <>
      <path d="M10.5 3.5l3 3-3 3" />
      <path d="M13.5 6.5H6.3a3.5 3.5 0 000 7h2.2" />
    </>,
  )
export const ChevronIcon = (): ReactElement => svg(<path d="M4 6l4 4 4-4" />, 11)
export const FillIcon = (): ReactElement =>
  svg(
    <>
      <path d="M10.2 2.2l3.6 3.6-6 6H4.2V8.2z" />
      <path d="M8.4 4l3.6 3.6" />
      <path d="M4.2 11.8l-1.8 1.8" />
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
export const AdmonitionIcon = ({ variant }: { variant: string }): ReactElement => {
  switch (variant) {
    case 'TIP':
      return svg(<path d="M6 12.8h4M6.6 14.6h2.8M8 1.6a4.2 4.2 0 00-2.5 7.6c.6.4.9 1 .9 1.8h3.2c0-.8.3-1.4.9-1.8A4.2 4.2 0 008 1.6z" />)
    case 'IMPORTANT':
      return svg(<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.5l-3.8 2.1.7-4.3-3.1-3 4.3-.6z" />)
    case 'WARNING':
      return svg(
        <>
          <path d="M8 2.2l6.2 11H1.8z" />
          <path d="M8 6.4v3.2" />
          <circle cx="8" cy="11.4" r="0.9" fill="currentColor" stroke="none" />
        </>,
      )
    case 'CAUTION':
      return svg(
        <>
          <path d="M5.5 1.8h5l3.7 3.7v5l-3.7 3.7h-5l-3.7-3.7v-5z" />
          <path d="M8 5v3.6" />
          <circle cx="8" cy="11" r="0.9" fill="currentColor" stroke="none" />
        </>,
      )
    default:
      return svg(
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7.2v4" />
          <circle cx="8" cy="5" r="0.9" fill="currentColor" stroke="none" />
        </>,
      )
  }
}
export const PlusIcon = (): ReactElement => svg(<path d="M8 3v10M3 8h10" />)

// the buttons of the panel of a table
export const RowAddIcon = (): ReactElement =>
  svg(
    <>
      <rect x="2" y="2" width="12" height="6" rx="1.2" />
      <path d="M8 10.2v4M6 12.2h4" />
    </>,
  )
export const ColAddIcon = (): ReactElement =>
  svg(
    <>
      <rect x="2" y="2" width="6" height="12" rx="1.2" />
      <path d="M10.4 8h4M12.4 6v4" />
    </>,
  )
export const RowDelIcon = (): ReactElement =>
  svg(
    <>
      <rect x="2" y="2" width="12" height="6" rx="1.2" />
      <path d="M6 12.2h4" />
    </>,
  )
export const ColDelIcon = (): ReactElement =>
  svg(
    <>
      <rect x="2" y="2" width="6" height="12" rx="1.2" />
      <path d="M10.4 8h4" />
    </>,
  )
export const MergeIcon = (): ReactElement =>
  svg(
    <>
      <rect x="1.8" y="3" width="12.4" height="10" rx="1.5" />
      <path d="M4.5 8h2.2M9.3 8h2.2M5.6 6.6L7 8 5.6 9.4M10.4 6.6L9 8l1.4 1.4" />
    </>,
  )
export const SplitIcon = (): ReactElement =>
  svg(
    <>
      <rect x="1.8" y="3" width="12.4" height="10" rx="1.5" />
      <path d="M8 3v10" strokeDasharray="2 1.6" />
    </>,
  )
export const HeadIcon = (): ReactElement =>
  svg(
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2.6 5.6h10.8" strokeWidth="3.2" />
    </>,
  )
export const NestIcon = (): ReactElement =>
  svg(
    <>
      <rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.5" />
      <rect x="6" y="6" width="6" height="6" rx="1" />
      <path d="M6 9h6M9 6v6" />
    </>,
  )
export const TrashIcon = (): ReactElement => svg(<path d="M3 4.5h10M6.4 4.5V3h3.2v1.5M4.4 4.5l.6 8.5h6l.6-8.5" />)
export const DotsIcon = (): ReactElement =>
  svg(
    <>
      <circle cx="3.5" cy="8" r="1" fill="currentColor" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1" fill="currentColor" />
    </>,
  )
export const CaptionIcon = (): ReactElement => svg(<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h6" />)
export const AnchorIcon = (): ReactElement =>
  svg(
    <>
      <circle cx="8" cy="4" r="1.5" />
      <path d="M8 5.5v7.5M4.5 9.5C4.5 11.5 6 13 8 13s3.5-1.5 3.5-3.5M3 9.5h3M10 9.5h3" />
    </>,
  )

export const CheckIcon = (): ReactElement => svg(<path d="M3.5 8.5l3 3 6-7" />, 12)
/** «Заливка ячейки» (значок А): a 2×2 table with a bucket at its lower right corner; the table is cut under the bucket by a mask. */
const BUCKET = 'M10.2 5.6l4.2 4.2-3.6 3.6a1.2 1.2 0 0 1-1.7 0L6.6 10.9a1.2 1.2 0 0 1 0-1.7z'
export function CellFillIcon(): ReactElement {
  // an own id for every copy: a hidden copy must not break the mask of the others
  const id = `cf${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return svg(
    <>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16">
        <rect width="16" height="16" fill="#fff" stroke="none" />
        <path d={BUCKET} fill="#000" stroke="#000" strokeWidth="3.3" />
      </mask>
      <g mask={`url(#${id})`}>
        <rect x="1.8" y="2.2" width="10" height="8.8" rx="1.4" />
        <path d="M1.8 6.2h10M6.8 6.2v4.8" />
      </g>
      <path d={BUCKET} />
      <path d="M7 9.4h7" />
      <path d="M14.6 11.6c.5.8 1 1.4 1 2a1 1 0 0 1-2 0c0-.6.5-1.2 1-2z" fill="currentColor" strokeWidth="0.5" />
    </>,
  )
}

// the capsule of selected cells.
/** «Выравнивание»: lines of the text in a cell frame. */
export const AlignIcon = (): ReactElement =>
  svg(
    <>
      <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.5" />
      <path d="M4.6 6h6.8M6.4 8h3.2M4.6 10h6.8" />
    </>,
  )
const H_LINES = {
  left: 'M2.5 4h11M2.5 8h6.5M2.5 12h9',
  center: 'M2.5 4h11M4.8 8h6.4M3.5 12h9',
  right: 'M2.5 4h11M7 8h6.5M4.5 12h9',
} as const
export const AlignHIcon = (props: { at: 'left' | 'center' | 'right' }): ReactElement => svg(<path d={H_LINES[props.at]} />)
const V_BARS = {
  top: 'M2.5 2.5h11M5.5 5.5h5',
  middle: 'M2.5 8h11M5.5 5.5h5v5h-5z',
  bottom: 'M2.5 13.5h11M5.5 10.5h5',
} as const
export const AlignVIcon = (props: { at: 'top' | 'middle' | 'bottom' }): ReactElement =>
  svg(
    <>
      <path d="M1.5 1.5v13M14.5 1.5v13" strokeOpacity="0.35" />
      <path d={V_BARS[props.at]} />
    </>,
  )
/** «Очистить»: an eraser. */
export const EraseIcon = (): ReactElement =>
  svg(
    <>
      <path d="M9.4 3l3.8 3.8a1 1 0 010 1.4l-4.6 4.6H5.9L2.8 9.7a1 1 0 010-1.4L8 3a1 1 0 011.4 0z" />
      <path d="M5.2 6.2l4.6 4.6M7.6 12.8h6" />
    </>,
  )
