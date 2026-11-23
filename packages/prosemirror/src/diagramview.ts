/**
 * The node view of a diagram: the picture of the code, and (while the cursor is in the block) the code beside it. The picture is
 * drawn by the function the host gives (`renderDiagram`), as the pictures of images come from the resolver the host gives: this
 * package draws nothing itself and loads nothing. While the code is typed the picture stays; a pause of 300 ms after the last
 * change draws the new one. When the code does not parse, the last good picture stays, greyed, with the text of the error under it.
 */
import { TextSelection } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView } from 'prosemirror-view'
import { getLabels } from './schema.js'

/** `light` or `dark`: the theme the picture is drawn in. */
export type DiagramTheme = 'light' | 'dark'

/**
 * Draws the code of a diagram and gives the picture as the markup of an SVG. A code that does not parse rejects with the error
 * (its message is shown as it is); a renderer that is not there (its file did not load) rejects with {@link RendererMissing}.
 */
export type DiagramRenderer = (code: string, theme: DiagramTheme) => Promise<string>

/** The renderer could not be loaded: no diagram can be drawn, and trying again does not help until the page is opened anew. */
export class RendererMissing extends Error {
  constructor(message = 'The renderer of diagrams did not load') {
    super(message)
    this.name = 'RendererMissing'
  }
}

/** What a diagram view needs of its editor. */
export interface DiagramHost {
  readonly render: DiagramRenderer | undefined
  readonly theme: () => DiagramTheme
  /** The views alive, so that a change of theme can redraw them. */
  readonly views: Set<DiagramView>
}

/** The pause after the last change of the code before the picture is drawn again, in milliseconds. */
export const DIAGRAM_PAUSE = 300

export class DiagramView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private readonly top: HTMLElement
  private readonly title: HTMLElement
  private readonly hint: HTMLElement
  private readonly hintIdle: HTMLElement
  private readonly hintEdit: HTMLElement
  private readonly box: HTMLElement
  private readonly bar: HTMLElement
  private readonly barText: HTMLElement
  private readonly barError: HTMLElement
  private code: string
  private good: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private ticket = 0
  private destroyed = false
  private missing = false

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly host: DiagramHost,
  ) {
    const doc = view.dom.ownerDocument
    const labels = getLabels()
    this.dom = doc.createElement('div')
    this.dom.className = 'nota-diagram drawing'
    this.top = doc.createElement('div')
    this.top.className = 'diagram-top'
    this.top.contentEditable = 'false'
    this.title = doc.createElement('span')
    this.title.className = 'diagram-title'
    this.hint = doc.createElement('span')
    this.hint.className = 'diagram-hint'
    this.hintIdle = doc.createElement('span')
    this.hintIdle.className = 'hint-idle'
    this.hintEdit = doc.createElement('span')
    this.hintEdit.className = 'hint-edit'
    this.top.append(this.title, this.hint)
    const main = doc.createElement('div')
    main.className = 'diagram-main'
    this.contentDOM = doc.createElement('pre')
    this.contentDOM.className = 'diagram-src'
    this.box = doc.createElement('div')
    this.box.className = 'diagram-box'
    this.box.contentEditable = 'false'
    main.append(this.contentDOM, this.box)
    this.bar = doc.createElement('div')
    this.bar.className = 'diagram-bar'
    this.bar.contentEditable = 'false'
    this.bar.setAttribute('role', 'alert')
    this.bar.hidden = true
    this.barText = doc.createElement('div')
    this.barText.className = 'diagram-bar-text'
    this.barError = doc.createElement('pre')
    this.barError.className = 'diagram-bar-error'
    this.bar.append(this.barText, this.barError)
    this.dom.append(this.top, main, this.bar)
    this.code = node.textContent
    this.labelTop()
    this.hintIdle.textContent = labels.diagramHint
    this.hintEdit.textContent = labels.diagramEditHint
    this.hint.append(this.hintIdle, this.hintEdit)
    // a click on the picture is a move of the cursor into the code, whatever is under it (a link, a node with a `click`)
    this.box.addEventListener('mousedown', (e) => this.enter(e))
    this.box.addEventListener(
      'click',
      (e) => {
        // (the page around the editor must not see it: VS Code opens the link of a click)
        e.preventDefault()
        e.stopPropagation()
      },
      true,
    )
    this.top.addEventListener('mousedown', (e) => this.enter(e))
    host.views.add(this)
    this.show(this.drawing())
    this.draw()
  }

  private labelTop(): void {
    const name = this.node.attrs.name as string
    this.title.textContent = name === '' ? getLabels().diagramTitle : `${getLabels().diagramTitle} · ${name}`
  }

  private drawing(): HTMLElement {
    const doc = this.dom.ownerDocument
    const wrap = doc.createElement('div')
    wrap.className = 'diagram-wait'
    const spin = doc.createElement('span')
    spin.className = 'diagram-spin'
    const text = doc.createElement('span')
    text.textContent = getLabels().diagramDrawing
    wrap.append(spin, text)
    return wrap
  }

  private show(content: Element): void {
    this.box.replaceChildren(content)
  }

  /** The cursor goes into the code, at its end. */
  private enter(event: MouseEvent): void {
    event.preventDefault()
    const pos = this.getPos()
    if (pos === undefined || this.view.isDestroyed) return
    const state = this.view.state
    const at = pos + 1 + this.node.content.size
    this.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, at)).scrollIntoView())
    this.view.focus()
  }

  /** Draws the picture of the code now (the theme may have changed). */
  private draw(): void {
    const ticket = ++this.ticket
    const code = this.code
    const render = this.host.render
    if (!render) return this.noDrawer()
    const theme = this.host.theme()
    let promise: Promise<string>
    try {
      promise = render(code, theme)
    } catch (e) {
      promise = Promise.reject(e)
    }
    promise.then(
      (svg) => {
        if (this.destroyed || ticket !== this.ticket) return
        this.good = svg
        this.dom.classList.remove('drawing', 'broken', 'stale', 'nodrawer')
        this.dom.classList.add('drawn')
        this.bar.hidden = true
        const holder = this.dom.ownerDocument.createElement('div')
        holder.className = 'diagram-pic'
        holder.innerHTML = svg
        this.box.replaceChildren(holder)
      },
      (e: unknown) => {
        if (this.destroyed || ticket !== this.ticket) return
        if (e instanceof RendererMissing) return this.noDrawer()
        this.fail(e instanceof Error ? e.message : String(e))
      },
    )
  }

  private noDrawer(): void {
    this.missing = true
    const labels = getLabels()
    const doc = this.dom.ownerDocument
    this.dom.classList.remove('drawing', 'drawn', 'stale', 'broken')
    this.dom.classList.add('nodrawer')
    const plate = doc.createElement('div')
    plate.className = 'diagram-plate nodrawer'
    const a = doc.createElement('div')
    a.className = 'diagram-plate-title'
    a.textContent = labels.diagramNoRenderer
    const b = doc.createElement('div')
    b.className = 'diagram-plate-hint'
    b.textContent = labels.diagramNoRendererHint
    plate.append(a, b)
    this.box.replaceChildren(plate)
    this.bar.hidden = true
  }

  private fail(message: string): void {
    const labels = getLabels()
    const doc = this.dom.ownerDocument
    this.dom.classList.remove('drawing', 'nodrawer')
    this.bar.hidden = false
    this.barError.textContent = message
    if (this.good !== null) {
      // the picture of the last good code stays, greyed
      this.dom.classList.add('stale', 'drawn')
      this.dom.classList.remove('broken')
      this.barText.textContent = labels.diagramKept
      return
    }
    this.dom.classList.add('broken')
    this.dom.classList.remove('drawn', 'stale')
    const plate = doc.createElement('div')
    plate.className = 'diagram-plate failed'
    const a = doc.createElement('div')
    a.className = 'diagram-plate-title'
    a.textContent = labels.diagramFailed
    const b = doc.createElement('div')
    b.className = 'diagram-plate-hint'
    b.textContent = labels.diagramFailedHint
    plate.append(a, b)
    this.box.replaceChildren(plate)
    this.barText.textContent = labels.diagramFailedBar
  }

  /** The picture is drawn again (the theme of the page changed). */
  redraw(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    if (this.missing) return
    this.draw()
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const renamed = node.attrs.name !== this.node.attrs.name
    this.node = node
    if (renamed) this.labelTop()
    const code = node.textContent
    if (code !== this.code) {
      this.code = code
      if (this.timer !== null) clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        this.timer = null
        this.draw()
      }, DIAGRAM_PAUSE)
    }
    return true
  }

  ignoreMutation(mutation: { target: Node; type: string }): boolean {
    return mutation.type === 'selection' ? false : !this.contentDOM.contains(mutation.target)
  }

  stopEvent(event: Event): boolean {
    const t = event.target as Node
    return this.box.contains(t) || this.bar.contains(t) || this.top.contains(t)
  }

  destroy(): void {
    this.destroyed = true
    if (this.timer !== null) clearTimeout(this.timer)
    this.host.views.delete(this)
  }
}
