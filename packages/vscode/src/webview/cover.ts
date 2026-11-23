/** How far the capsules (and the plate of a big file) reach down from the top of a box, px: the text under that is covered. */
export function coverFrom(boxTop: number, bottoms: readonly number[]): number {
  return Math.max(0, Math.max(boxTop, ...bottoms) - boxTop)
}

/** The height in the source, from which the first line not under the capsules is looked for. */
export function sourceTopHeight(scrollTop: number, cover: number, paddingTop: number): number {
  return Math.max(0, scrollTop + cover - paddingTop)
}

/** The room the row of capsules takes at least, px (the same as `min-height` of `.ed-isles` in the styles). */
export const ISLES_MIN_HEIGHT = 52
