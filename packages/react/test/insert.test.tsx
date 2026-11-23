// the button «Вставить», the menu of «/», the language of code.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BlockBar, ImagePicker, InsertMenu, SlashMenu, Toolbar, editorLabels } from '@nota-adoc/react'
import { ENGLISH_LABELS, setLabels } from '@nota-adoc/prosemirror'
import { open, select, setupCleanup } from './helpers.js'

setupCleanup()

const noop = (): void => undefined

describe('the button «Вставить»', () => {
  it('has its hint, is off in the mode «Текст» and asks for the menu', () => {
    const s = open('one\n')
    const onInsert = vi.fn()
    const { rerender } = render(<Toolbar editor={s.editor} locale="ru" onLink={noop} onColor={noop} onInsert={onInsert} />)
    const button = screen.getByLabelText('Вставить')
    expect(button.getAttribute('title')).toBe('Вставить таблицу, код, картинку… Быстрее — «/» в пустой строке')
    fireEvent.click(button)
    expect(onInsert).toHaveBeenCalledTimes(1)
    rerender(<Toolbar editor={s.editor} locale="ru" disabled onLink={noop} onColor={noop} onInsert={onInsert} />)
    expect((screen.getByLabelText('Вставить') as HTMLButtonElement).disabled).toBe(true)
  })

  it('the menu has the six blocks', () => {
    const s = open('one\n')
    const anchor = document.createElement('button')
    document.body.append(anchor)
    const onPick = vi.fn()
    render(<InsertMenu locale="ru" anchor={anchor} container={document.body} onPick={onPick} onClose={noop} />)
    expect(screen.getAllByRole('menuitem').map((e) => e.textContent)).toEqual([
      'ТаблицаРяды и колонки',
      'КодС подсветкой',
      'MermaidСхема из текста',
      'ПредупреждениеПримечание, совет, внимание…',
      'Раскрывающийся блокСкрытые подробности',
      'КартинкаС подписью',
    ])
    fireEvent.click(screen.getByText('Код'))
    expect(onPick).toHaveBeenCalledWith('code')
    void s
  })
})

describe('the menu of «/»', () => {
  const slash = (s: ReturnType<typeof open>, text: string): void => {
    act(() => {
      select(s.editor, 1, 0)
      const { view } = s.editor
      view.dispatch(view.state.tr.insertText(text, view.state.selection.from))
    })
  }

  it('shows the fourteen entries, narrows them by the text, and Esc dismisses it', () => {
    const s = open('a\n\n\n')
    render(<SlashMenu editor={s.editor} locale="ru" container={document.body} onImage={noop} />)
    expect(screen.queryByRole('listbox')).toBeNull()
    slash(s, '/')
    expect(screen.getByText('Вставить блок')).toBeTruthy()
    expect(screen.getAllByRole('option').map((e) => e.textContent)).toEqual([
      'Заголовок 2Ctrl+Alt+2Раздел документа',
      'Заголовок 3Ctrl+Alt+3Подраздел',
      'Заголовок 4Ctrl+Alt+4Уровень 4',
      'Заголовок 5Ctrl+Alt+5Уровень 5',
      'Заголовок 6Ctrl+Alt+6Уровень 6',
      'Маркированный списокПункты с точками',
      'Нумерованный списокПункты по порядку',
      'Чек-листПункты с флажками',
      'ТаблицаРяды и колонки',
      'КодС подсветкой',
      'MermaidСхема из текста',
      'ПредупреждениеПримечание, совет, внимание…',
      'Раскрывающийся блокСкрытые подробности',
      'КартинкаС подписью',
    ])
    slash(s, 'код')
    act(() => undefined)
    fireEvent.keyDown(s.editor.view.dom, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(s.session.text).toContain('/')
  })

  it('is found by its words and puts a diagram with a sample in the place of «/»', () => {
    const s = open('a\n\n\n')
    render(<SlashMenu editor={s.editor} locale="ru" container={document.body} onImage={noop} />)
    slash(s, '/диагр')
    expect(screen.getAllByRole('option').map((e) => e.textContent)).toEqual(['MermaidСхема из текста'])
    fireEvent.click(screen.getByText('Mermaid'))
    // the editor has no labels of its own: the sample is in English
    expect(s.session.text).toContain('[mermaid]\n....\nflowchart LR\nA[Start] --> B[Step]\nB --> C(Done)\n....')
    expect(s.session.text).not.toContain('/')
  })

  it('puts the sample of the diagram in the language of the labels of the editor', () => {
    try {
      setLabels(editorLabels('ru'))
      const ru = open('a\n\n\n')
      expect(ru.editor.commands.insertBlock('mermaid')).toBe(true)
      expect(ru.session.text).toContain('[mermaid]\n....\nflowchart LR\nA[Начало] --> B[Шаг]\nB --> C(Готово)\n....')
      setLabels(editorLabels('en'))
      const en = open('a\n\n\n')
      expect(en.editor.commands.insertBlock('mermaid')).toBe(true)
      expect(en.session.text).toContain('flowchart LR\nA[Start] --> B[Step]\nB --> C(Done)')
    } finally {
      setLabels(ENGLISH_LABELS)
    }
  })

  it('the search finds the headings: «h5», «заголовок», and «heading 6» in English', () => {
    const found = (locale: 'ru' | 'en', text: string): (string | null)[] => {
      const s = open('a\n\n\n')
      const { unmount } = render(<SlashMenu editor={s.editor} locale={locale} container={document.body} onImage={noop} />)
      slash(s, text)
      const names = screen.getAllByRole('option').map((e) => e.querySelector('.sm-name')!.textContent)
      unmount()
      return names
    }
    expect(found('ru', '/h5')).toEqual(['Заголовок 5'])
    expect(found('ru', '/заголовок')).toEqual(['Заголовок 2', 'Заголовок 3', 'Заголовок 4', 'Заголовок 5', 'Заголовок 6'])
    expect(found('en', '/heading 6')).toEqual(['Heading 6'])
  })

  it('says so when nothing matches', () => {
    const s = open('a\n\n\n')
    render(<SlashMenu editor={s.editor} locale="ru" container={document.body} onImage={noop} />)
    slash(s, '/яяя')
    expect(screen.getByText('Ничего не найдено. Esc — оставить «/» обычным текстом')).toBeTruthy()
  })

  it('an entry put in the place of «/»', () => {
    const s = open('a\n\n\n')
    render(<SlashMenu editor={s.editor} locale="ru" container={document.body} onImage={noop} />)
    slash(s, '/')
    fireEvent.click(screen.getByText('Код'))
    expect(s.session.text).toContain('[source,text]\n----\n----')
    expect(s.session.text).not.toContain('/')
  })

  it('«Картинка» asks the host for a file', () => {
    const s = open('a\n\n\n')
    const onImage = vi.fn()
    render(<SlashMenu editor={s.editor} locale="ru" container={document.body} onImage={onImage} />)
    slash(s, '/')
    fireEvent.click(screen.getByText('Картинка'))
    expect(onImage).toHaveBeenCalledTimes(1)
  })
})

describe('the language of code', () => {
  it('is a field over the code that writes [source,lang]', () => {
    const s = open('----\nx\n----\n')
    render(<BlockBar editor={s.editor} locale="ru" container={document.body} />)
    act(() => select(s.editor, 0, 1))
    const field = document.querySelector('[data-cmd="language"]') as HTMLElement
    expect(field.getAttribute('aria-haspopup')).toBe('listbox')
    fireEvent.click(field)
    expect(screen.getByRole('listbox', { name: 'Язык' })).toBeTruthy()
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Текст',
      'Bash',
      'CSS',
      'HTML',
      'Java',
      'JavaScript',
      'JSON',
      'Python',
      'SQL',
      'TypeScript',
      'XML',
      'YAML',
    ])
    fireEvent.click(screen.getByRole('option', { name: 'Python' }))
    expect(s.session.text).toBe('[source,python]\n----\nx\n----\n')
  })
})

describe('the menu of «/» does not open', () => {
  const at = (s: ReturnType<typeof open>, index: number, offset: number, text: string): void => {
    act(() => {
      select(s.editor, index, offset)
      const { view } = s.editor
      view.dispatch(view.state.tr.insertText(text, view.state.selection.from))
    })
  }
  const closed = (source: string, index: number, offset: number): void => {
    const s = open(source)
    render(<SlashMenu editor={s.editor} locale="ru" container={document.body} onImage={noop} />)
    at(s, index, offset, '/')
    expect(screen.queryByRole('listbox')).toBeNull()
  }
  it('in a paragraph that has text', () => closed('слово\n', 0, 5))
  it('in a heading', () => closed('== Раздел\n', 0, 6))
  it('in an item of a list', () => closed('* пункт\n', 0, 5))
  it('in code', () => closed('----\nкод\n----\n', 0, 3))
  it('in a caption', () => closed('.Подпись\nimage::a.png[]\n', 0, 7))
  it('in an island', () => closed('include::part.adoc[]\n', 0, 3))

  it('in an empty paragraph inside a warning and inside a collapsible block', () => {
    for (const source of ['[NOTE]\n====\nтекст\n\n\n====\n', '.Подробнее\n[%collapsible%open]\n====\nтекст\n\n\n====\n']) {
      const s = open(source)
      render(<SlashMenu editor={s.editor} locale="ru" container={document.body} onImage={noop} />)
      let empty = -1
      s.editor.view.state.doc.forEach((n, _o, i) => {
        if (empty < 0 && n.type.name === 'paragraph' && n.content.size === 0) empty = i
      })
      expect(empty).toBeGreaterThanOrEqual(0)
      act(() => {
        select(s.editor, empty, 0)
        const { view } = s.editor
        view.dispatch(view.state.tr.insertText('/', view.state.selection.from))
      })
      expect(screen.getAllByRole('option').length).toBe(14)
      document.body.textContent = ''
    }
  })
})

describe('the picker of a picture', () => {
  const files = (items: string[]) => () => ({ items, more: 0 })

  it('lists the files, among them ones from a folder above, and picks one', async () => {
    const onPick = vi.fn()
    render(
      <ImagePicker locale="ru" anchor={null} container={document.body} listFiles={files(['../img/x.png', 'a.png'])} onPick={onPick} onClose={noop} />,
    )
    await screen.findByText('../img/x.png')
    fireEvent.click(screen.getByText('../img/x.png'))
    expect(onPick).toHaveBeenCalledWith('../img/x.png')
  })

  it('Esc closes the window and picks nothing', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    render(<ImagePicker locale="ru" anchor={null} container={document.body} listFiles={files(['a.png'])} onPick={onPick} onClose={onClose} />)
    await screen.findByText('a.png')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledWith(true)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('says so when the workspace has no images, in both languages', async () => {
    const { unmount } = render(
      <ImagePicker locale="ru" anchor={null} container={document.body} listFiles={files([])} onPick={noop} onClose={noop} />,
    )
    expect(screen.getByText('В рабочей папке нет картинок')).toBeTruthy()
    unmount()
    render(<ImagePicker locale="en" anchor={null} container={document.body} listFiles={files([])} onPick={noop} onClose={noop} />)
    expect(screen.getByText('No images in the workspace')).toBeTruthy()
  })
})
