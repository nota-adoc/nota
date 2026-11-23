/** A rectangle in the coordinates of the window. */
export interface Rect {
  readonly top: number
  readonly bottom: number
  readonly left: number
}

export interface FitOptions {
  /** The gap between the anchor and the window, px. */
  gap?: number
  /** The window may not go over this line (the lower edge of the capsules), in the coordinates of the window. */
  topLimit?: number
  /** The side is decided already (the menu of «/» keeps its side while it is open): only the height changes. */
  side?: 'down' | 'up'
  /** Never above the anchor: the window hangs under it or shrinks. */
  noFlip?: boolean
}

/** The room the windows keep from the edges of the container, px. */
const EDGE = 8
/** The least height a window is squeezed to, px. */
const LEAST = 80

/**
 * Where a window goes, by the rectangle of its anchor: under the anchor when it fits; else above it when it fits; else on the side
 * with more room, squeezed (`max-height` and a scroll of its own). The edges are those of the container met with the window of the
 * browser, so the window never makes the page scroll. Returns the side taken.
 */
export function fitWindow(pop: HTMLElement, anchor: Rect, container: HTMLElement, options: FitOptions = {}): 'down' | 'up' {
  const { gap = 6, topLimit = 0 } = options
  const doc = pop.ownerDocument
  const box = container.getBoundingClientRect()
  const view = { w: doc.documentElement.clientWidth || doc.defaultView?.innerWidth || 0, h: doc.documentElement.clientHeight || doc.defaultView?.innerHeight || 0 }
  const right = view.w > 0 ? Math.min(box.right, view.w) : box.right
  const top = Math.max(box.top, topLimit, 0) + EDGE
  const bottom = (view.h > 0 ? Math.min(box.bottom, view.h) : box.bottom) - EDGE

  pop.style.maxHeight = ''
  pop.style.overflowY = ''
  delete pop.dataset.up
  const w = pop.offsetWidth
  const x = Math.max(EDGE, Math.min(anchor.left - box.left, right - box.left - w - EDGE))
  pop.style.left = `${x}px`

  const h = pop.offsetHeight
  const below = bottom - (anchor.bottom + gap)
  const above = anchor.top - gap - top
  // no layout (a test without it) or no container height: as before, under the anchor
  if (box.height <= 0 || h <= 0) {
    pop.style.top = `${Math.max(EDGE, anchor.bottom - box.top + gap)}px`
    return 'down'
  }
  let side: 'down' | 'up' = options.side ?? (h <= below || options.noFlip ? 'down' : h <= above ? 'up' : below >= above ? 'down' : 'up')
  if (options.noFlip) side = 'down'
  const room = side === 'down' ? below : above
  const height = Math.min(h, Math.max(LEAST, room))
  if (height < h) {
    pop.style.maxHeight = `${height}px`
    pop.style.overflowY = 'auto'
  }
  if (side === 'up') {
    pop.dataset.up = ''
    pop.style.top = `${Math.max(EDGE, anchor.top - gap - height - box.top)}px`
  } else pop.style.top = `${Math.max(EDGE, anchor.bottom + gap - box.top)}px`
  return side
}

/**
 * Where a window goes: under an anchor, inside a container, kept within its edges (above the anchor, or squeezed, when there is no room
 * below). An anchor inside an element with the attribute `data-hang` hangs the window from the lower edge of that element
 * (a capsule that reaches down over the text), sideways from the anchor itself.
 */
export function placeBelow(pop: HTMLElement, anchor: HTMLElement, container: HTMLElement): void {
  const at = anchor.getBoundingClientRect()
  const hang = anchor.closest('[data-hang]')?.getBoundingClientRect().bottom
  fitWindow(pop, hang === undefined ? at : { top: at.top, left: at.left, bottom: Math.max(at.bottom, hang) }, container, { noFlip: hang !== undefined })
}
