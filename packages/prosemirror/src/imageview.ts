/**
 * The node view of a block image: the picture (or a plate that says why there is none) over the caption. The picture is
 * only ever drawn from an address the host gives (`images`); a target the host does not resolve is a plate, and no request is
 * made for it.
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { NodeView } from 'prosemirror-view'
import { getLabels } from './schema.js'

/** What the host says of the target of an image: where its picture is, or why it is not shown. */
export type ImageSource = { readonly url: string } | { readonly plate: 'remote' | 'missing' }

/** Resolves the target of an image as written in the file. */
export type ImageResolver = (target: string) => ImageSource

export class ImageView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private readonly box: HTMLElement
  private target = ''

  constructor(
    private node: PMNode,
    private readonly resolve: ImageResolver | undefined,
  ) {
    const doc = typeof document === 'undefined' ? null : document
    if (!doc) throw new Error('an image needs a document')
    this.dom = doc.createElement('figure')
    this.dom.className = 'nota-image'
    this.box = doc.createElement('div')
    this.box.className = 'image-box'
    this.box.contentEditable = 'false'
    this.contentDOM = doc.createElement('figcaption')
    this.contentDOM.dataset.placeholder = getLabels().captionPlaceholder
    this.dom.append(this.box, this.contentDOM)
    this.draw()
  }

  private plate(kind: 'remote' | 'missing'): void {
    const doc = this.dom.ownerDocument
    const labels = getLabels()
    const plate = doc.createElement('div')
    plate.className = `image-plate ${kind}`
    const text = doc.createElement('span')
    text.className = 'image-plate-text'
    text.textContent = kind === 'remote' ? labels.imageRemote : labels.imageMissing.replace('{path}', this.target)
    plate.append(text)
    if (kind === 'remote') {
      const address = doc.createElement('code')
      address.className = 'image-plate-address'
      address.textContent = this.target
      plate.append(address)
    }
    this.box.replaceChildren(plate)
  }

  private draw(): void {
    this.target = this.node.attrs.target as string
    this.dom.dataset.target = this.target
    const source: ImageSource = this.resolve ? this.resolve(this.target) : { plate: 'missing' }
    if ('plate' in source) return this.plate(source.plate)
    const img = this.dom.ownerDocument.createElement('img')
    img.className = 'image-pic'
    img.alt = this.target
    img.addEventListener('error', () => this.plate('missing'))
    img.src = source.url
    this.box.replaceChildren(img)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const changed = node.attrs.target !== this.node.attrs.target
    this.node = node
    if (changed) this.draw()
    return true
  }

  ignoreMutation(mutation: { target: Node; type: string }): boolean {
    return mutation.type === 'selection' ? false : !this.contentDOM.contains(mutation.target)
  }

  stopEvent(event: Event): boolean {
    return this.box.contains(event.target as Node) && event.type !== 'mousedown'
  }
}
