// where a window goes by given rectangles: under the anchor, above it, or squeezed; never out of the container.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Dropdown } from '@nota-adoc/react'
import { fitWindow, placeBelow } from '../src/place.js'
import { setupCleanup } from './helpers.js'

setupCleanup()

const rect = (top: number, bottom: number, left = 0, right = left + 10) => ({ top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect
function setup(box: { top: number; bottom: number; width: number }, size: { w: number; h: number }) {
  const container = document.createElement('div')
  container.getBoundingClientRect = () => rect(box.top, box.bottom, 0, box.width)
  const pop = document.createElement('div')
  Object.defineProperty(pop, 'offsetWidth', { get: () => size.w })
  Object.defineProperty(pop, 'offsetHeight', { get: () => (pop.style.maxHeight ? Math.min(size.h, Number.parseFloat(pop.style.maxHeight)) : size.h) })
  container.append(pop)
  document.body.append(container)
  return { container, pop }
}

describe('fitWindow', () => {
  it('goes under the anchor when it fits', () => {
    const { container, pop } = setup({ top: 0, bottom: 600, width: 1000 }, { w: 220, h: 300 })
    expect(fitWindow(pop, { top: 100, bottom: 120, left: 50 }, container, { gap: 4 })).toBe('down')
    expect(pop.style.top).toBe('124px')
    expect(pop.style.left).toBe('50px')
    expect(pop.style.maxHeight).toBe('')
  })
  it('goes above the anchor when it does not fit below but fits above', () => {
    const { container, pop } = setup({ top: 0, bottom: 600, width: 1000 }, { w: 220, h: 300 })
    expect(fitWindow(pop, { top: 500, bottom: 520, left: 50 }, container, { gap: 4 })).toBe('up')
    expect(pop.style.top).toBe('196px')
    expect(pop.dataset.up).toBe('')
  })
  it('is squeezed, on the side with more room, when it fits on neither', () => {
    const { container, pop } = setup({ top: 0, bottom: 360, width: 1000 }, { w: 220, h: 450 })
    expect(fitWindow(pop, { top: 200, bottom: 220, left: 50 }, container, { gap: 4 })).toBe('up')
    expect(pop.style.maxHeight).toBe('188px')
    expect(pop.style.overflowY).toBe('auto')
    expect(pop.style.top).toBe('8px')
    const low = setup({ top: 0, bottom: 360, width: 1000 }, { w: 220, h: 450 })
    expect(fitWindow(low.pop, { top: 100, bottom: 120, left: 50 }, low.container, { gap: 4 })).toBe('down')
    expect(low.pop.style.maxHeight).toBe('228px')
  })
  it('keeps the side it was given and the line under the capsules', () => {
    const { container, pop } = setup({ top: 0, bottom: 600, width: 1000 }, { w: 220, h: 300 })
    expect(fitWindow(pop, { top: 100, bottom: 120, left: 50 }, container, { gap: 4, side: 'up' })).toBe('up')
    expect(pop.style.maxHeight).toBe('88px')
    expect(fitWindow(pop, { top: 150, bottom: 170, left: 50 }, container, { gap: 4, side: 'up', topLimit: 120 })).toBe('up')
    expect(pop.style.maxHeight).toBe('80px')
  })
  it('keeps the window inside the width of the container', () => {
    const { container, pop } = setup({ top: 0, bottom: 600, width: 390 }, { w: 300, h: 100 })
    fitWindow(pop, { top: 100, bottom: 120, left: 380 }, container)
    expect(pop.style.left).toBe('82px')
  })
  it('placeBelow hangs from the capsule and never goes above it', () => {
    const { container, pop } = setup({ top: 0, bottom: 300, width: 1000 }, { w: 220, h: 400 })
    const anchor = document.createElement('button')
    anchor.getBoundingClientRect = () => rect(10, 30, 20)
    container.append(anchor)
    placeBelow(pop, anchor, container)
    expect(pop.style.top).toBe('36px')
    expect(pop.style.maxHeight).toBe('256px')
  })
})

describe('the list of the drop-down', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ value: `v${i}`, label: `Item ${i}` }))
  const measured = (layer: HTMLElement, at: { top: number; bottom: number }): void => {
    layer.getBoundingClientRect = () => rect(0, 360, 0, 500)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('dd-list') ? Math.min(400, this.style.maxHeight ? Number.parseFloat(this.style.maxHeight) : 400) : 0 } })
    HTMLElement.prototype.getBoundingClientRect = function () { return this.classList.contains('dd') ? rect(at.top, at.bottom, 10, 80) : rect(0, 0) }
  }
  it('is squeezed to the layer when there is no room above or below', () => {
    const layer = document.createElement('div')
    document.body.append(layer)
    const holder = document.createElement('div')
    layer.append(holder)
    measured(layer, { top: 150, bottom: 170 })
    render(
      <Dropdown items={items} value={null} label="L" bounds={() => layer} onPick={() => {}}>
        x
      </Dropdown>,
      { container: holder },
    )
    fireEvent.click(screen.getByRole('button'))
    const list = screen.getByRole('listbox')
    expect(list.style.maxHeight).toBe('176px')
    delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect
  })
})
