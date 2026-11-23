// jsdom has no layout: every element measures as 0×0, and a Range has no client rects. CodeMirror needs both
// to measure. Give the editor and its scroller a tall box, so that the whole document of a test is rendered,
// and a Range no rectangles.
const original = HTMLElement.prototype.getBoundingClientRect
HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
  if (['cm-scroller', 'cm-editor', 'cm-content'].some((c) => this.classList.contains(c)))
    return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 1_000_000, width: 800, height: 1_000_000, toJSON() {} }
  return original.call(this)
}
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getClientRects = emptyRects
Range.prototype.getBoundingClientRect = () => new DOMRect()
Object.defineProperty(window, 'innerHeight', { value: 1_000_000, configurable: true })
