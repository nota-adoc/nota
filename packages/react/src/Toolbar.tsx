import type { VisualEditor } from '@nota-adoc/prosemirror'
import type { CSSProperties, MouseEvent, ReactElement } from 'react'
import { Dropdown } from './Dropdown.js'
import {
  BulletListIcon,
  CellFillIcon,
  CheckListIcon,
  ChevronIcon,
  CodeIcon,
  FillIcon,
  LinkIcon,
  NumberListIcon,
  PlusIcon,
  RedoIcon,
  UndoIcon,
} from './icons.js'
import { hint } from './keys.js'
import { isMac, keyLabel, type TipBind } from './Tooltip.js'
import type { Locale } from './locale.js'
import { messages } from './messages.js'
import { ROLE_VAR } from './roles.js'
import { type MarkKey, type StyleValue, useEditorState } from './useEditorState.js'

/** Which window of the panel is open, for `aria-expanded`. */
export type OpenPopover = 'link' | 'color' | 'fill' | 'insert' | null

export interface FormatActions {
  /** Called before a command of the panel: the message of an earlier refusal goes away. */
  onBeforeCommand?(): void
  /** «Ссылка» was pressed: open the field of the link under `anchor`. */
  onLink(anchor: HTMLElement): void
  /** «Цвет текста» or «Заливка» was pressed: open the window under `anchor`. */
  onColor(kind: 'color' | 'fill', anchor: HTMLElement, keyboard?: boolean): void
  /** «Вставить» was pressed: open the menu of blocks under `anchor`. */
  onInsert?(anchor: HTMLElement): void
}

export interface ToolbarProps extends FormatActions {
  editor: VisualEditor | undefined
  locale: Locale
  /** The mode of the source: the buttons are off and the note is shown. */
  disabled?: boolean
  open?: OpenPopover
}

const MARK_BUTTONS: readonly { key: Exclude<MarkKey, 'link'>; mark: 'strong' | 'em' | 'code' | 'strike' | 'highlight'; label: 'bold' | 'italic' | 'monospace' | 'strikethrough' | 'highlight'; keys: { shift?: boolean; key: string } }[] = [
  { key: 'strong', mark: 'strong', label: 'bold', keys: { key: 'B' } },
  { key: 'em', mark: 'em', label: 'italic', keys: { key: 'I' } },
  { key: 'code', mark: 'code', label: 'monospace', keys: { key: 'E' } },
  { key: 'strike', mark: 'strike', label: 'strikethrough', keys: { shift: true, key: 'X' } },
  { key: 'highlight', mark: 'highlight', label: 'highlight', keys: { shift: true, key: 'H' } },
]

const LIST_BUTTONS = [
  { key: 'ul', list: 'unordered', label: 'bulletedList', Icon: BulletListIcon },
  { key: 'ol', list: 'ordered', label: 'numberedList', Icon: NumberListIcon },
  { key: 'check', list: 'checklist', label: 'checklist', Icon: CheckListIcon },
] as const

/** A press on a button must not take the selection from the editor: the button acts on the click. */
export const keepSelection = (event: MouseEvent): void => {
  if ((event.target as Element).closest('button')) event.preventDefault()
}

/** The glyph of a mark button. */
export function MarkGlyph({ mark }: { mark: string }): ReactElement {
  switch (mark) {
    case 'strong':
      return <span className="g-b">B</span>
    case 'em':
      return <span className="g-i">I</span>
    case 'code':
      return <CodeIcon />
    case 'strike':
      return <span className="g-s">S</span>
    default:
      return <span className="g-mark">ab</span>
  }
}

/** The button «Цвет текста» or «Заливка»: the stripe under the icon shows the colour of the selection. */
export function ColorButton(props: {
  kind: 'color' | 'fill' | 'cell'
  label: string
  /** The name of the colour now on (`Синий`): the hint says `Цвет текста: Синий`. */
  name?: string | undefined
  role: string | null
  disabled: boolean
  textMode?: boolean
  expanded: boolean
  className: string
  /** Roving focus of the panel: -1 takes the button out of the Tab order. */
  tabIndex?: number
  /** The popup of the button: with it the button has no `title`; `aria-label` stays. */
  tip?: TipBind
  onPress(anchor: HTMLElement, keyboard: boolean): void
}): ReactElement {
  const { kind, role, disabled, textMode, expanded } = props
  const label = role && props.name ? `${props.label}: ${props.name}` : props.label
  const stripe = role ? ({ '--sw': `var(${ROLE_VAR[role]})` } as CSSProperties) : undefined
  return (
    <button
      type="button"
      className={props.className}
      data-cmd={kind === 'cell' ? 'cell-fill' : kind}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-pressed={role !== null}
      aria-disabled={disabled}
      aria-label={label}
      {...(props.tabIndex === undefined ? {} : { tabIndex: props.tabIndex })}
      {...(props.tip ? props.tip : { title: label })}
      disabled={textMode ? true : undefined}
      onClick={(e) => !disabled && props.onPress(e.currentTarget, e.detail === 0)}
    >
      {kind === 'color' ? (
        <span className="g-tc">
          A<i style={stripe} />
        </span>
      ) : (
        <span className="g-fill">
          {kind === 'cell' ? <CellFillIcon /> : <FillIcon />}
          <i style={stripe} />
        </span>
      )}
      <ChevronIcon />
    </button>
  )
}

export function Toolbar(props: ToolbarProps): ReactElement {
  const { editor, locale, disabled = false, open = null } = props
  const t = messages[locale]
  const state = useEditorState(editor)
  const off = disabled || !editor
  const pale = off || state.plate
  const run = (command: (e: VisualEditor) => unknown, keepFocus = true): void => {
    if (!editor || off) return
    props.onBeforeCommand?.()
    command(editor)
    if (keepFocus) editor.focus()
  }
  const style: StyleValue | null = state.style
  const onStyle = (value: string): void => {
    run((e) => (value === 'p' ? e.commands.setBlockType('paragraph') : e.commands.setBlockType('heading', Number(value.slice(1)))))
  }
  const mac = isMac()
  const styleItems = [
    { value: 'p', label: t.text, keys: keyLabel('0', mac, { alt: true }) },
    ...[2, 3, 4, 5, 6].map((n) => ({ value: `h${n}`, label: t.heading(n), keys: keyLabel(String(n), mac, { alt: true }) })),
  ]
  return (
    <div className="ed-tb" role="toolbar" aria-label={t.toolbar} onMouseDown={keepSelection}>
      <Dropdown
        className="tb-style"
        cmd="style"
        items={styleItems}
        value={style}
        label={t.paragraphStyle}
        ariaLabel={t.paragraphStyle}
        title={hint(t.paragraphStyle, { alt: true, key: '0' })}
        disabled={pale || state.styleOff}
        onOpen={props.onBeforeCommand}
        onPick={onStyle}
      >
        {styleItems.find((i) => i.value === style)?.label ?? t.paragraphStyle}
      </Dropdown>
      <span className="tb-sep" />
      {MARK_BUTTONS.map((b) => (
        <button
          key={b.key}
          type="button"
          className="tb-b"
          data-cmd={b.key}
          aria-pressed={state.marks[b.key]}
          aria-disabled={pale}
          aria-label={t[b.label]}
          title={hint(t[b.label], b.keys)}
          disabled={disabled ? true : undefined}
          onClick={() => !pale && run((e) => e.commands.toggleMark(b.mark))}
        >
          <MarkGlyph mark={b.mark} />
        </button>
      ))}
      <button
        type="button"
        className="tb-b"
        data-cmd="link"
        aria-haspopup="dialog"
        aria-expanded={open === 'link'}
        aria-pressed={state.marks.link}
        aria-disabled={pale}
        disabled={disabled ? true : undefined}
        aria-label={t.link}
        title={t.link}
        onClick={(e) => {
          if (pale) return
          props.onBeforeCommand?.()
          props.onLink(e.currentTarget)
        }}
      >
        <LinkIcon />
      </button>
      <ColorButton
        kind="color"
        className="tb-b tb-fmt"
        label={t.textColor}
        name={state.textColor ? t.colors[state.textColor] : undefined}
        role={state.textColor}
        disabled={pale}
        textMode={disabled}
        expanded={open === 'color'}
        onPress={(a, k) => (props.onBeforeCommand?.(), props.onColor('color', a, k))}
      />
      <ColorButton
        kind="fill"
        className="tb-b tb-fmt"
        label={t.fill}
        name={state.fill ? t.fills[state.fill] : undefined}
        role={state.fill}
        disabled={pale}
        textMode={disabled}
        expanded={open === 'fill'}
        onPress={(a, k) => (props.onBeforeCommand?.(), props.onColor('fill', a, k))}
      />
      <span className="tb-sep" />
      {LIST_BUTTONS.map((b) => {
        const lOff = off || state.listOff
        return (
          <button
            key={b.key}
            type="button"
            className="tb-b"
            data-cmd={b.key}
            aria-pressed={state.list === b.list}
            aria-disabled={lOff}
            aria-label={t[b.label]}
            title={t[b.label]}
            disabled={disabled ? true : undefined}
            onClick={() => !lOff && run((e) => e.commands.toggleList(b.list))}
          >
            <b.Icon />
          </button>
        )
      })}
      <span className="tb-sep" />
      <button
        type="button"
        className="tb-b"
        data-cmd="insert"
        aria-haspopup="menu"
        aria-expanded={open === 'insert'}
        aria-disabled={off}
        disabled={disabled ? true : undefined}
        aria-label={t.insert}
        title={t.insertHint}
        onClick={(e) => {
          if (off) return
          props.onBeforeCommand?.()
          props.onInsert?.(e.currentTarget)
        }}
      >
        <PlusIcon />
        {t.insert}
        <ChevronIcon />
      </button>
      <span className="tb-sep" />
      <button
        type="button"
        className="tb-b"
        data-cmd="undo"
        aria-disabled={off}
        disabled={disabled ? true : undefined}
        aria-label={t.undo}
        title={hint(t.undo, { key: 'Z' })}
        onClick={() => run((e) => e.commands.undo())}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        className="tb-b"
        data-cmd="redo"
        aria-disabled={off}
        disabled={disabled ? true : undefined}
        aria-label={t.redo}
        title={hint(t.redo, { shift: true, key: 'Z' })}
        onClick={() => run((e) => e.commands.redo())}
      >
        <RedoIcon />
      </button>
      {disabled && <span className="tb-note">{t.textModeNote}</span>}
    </div>
  )
}
