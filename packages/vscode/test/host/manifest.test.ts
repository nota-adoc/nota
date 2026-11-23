// the setting nota.language and the manifest in two languages.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveLocale } from '../../src/strings.js'

const dir = join(import.meta.dirname, '../..')
const json = (name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('the manifest', () => {
  it('nota.language is ru / en / auto, auto by default, described in English and in Russian', () => {
    const nls = json('package.nls.json')
    const ruNls = json('package.nls.ru.json')
    const prop = json('package.json').contributes.configuration.properties['nota.language']
    expect(prop.enum).toEqual(['ru', 'en', 'auto'])
    expect(prop.default).toBe('auto')
    const text = (ref: string) => nls[ref.replace(/%/g, '')] as string
    const ruText = (ref: string) => ruNls[ref.replace(/%/g, '')] as string
    expect(text(prop.description)).not.toMatch(/[А-Яа-яЁё]/)
    expect(text(prop.description)).not.toMatch(/always Russian/)
    expect(text(prop.description)).toMatch(/follow the display language of VS Code/)
    expect(ruText(prop.description)).toMatch(/идут за языком интерфейса VS Code/)
    expect(ruText(prop.description)).not.toMatch(/всегда русские/)
    expect((prop.enumDescriptions as string[]).map(text)).toEqual(['Russian', 'English', 'As in VS Code'])
    expect((prop.enumDescriptions as string[]).map(ruText)).toEqual(['Русский', 'English', 'Как в VS Code'])
  })

  it('nota.pageWidth is a number 50–100, 85 by default, described in Russian and in English', () => {
    const nls = json('package.nls.ru.json')
    const prop = json('package.json').contributes.configuration.properties['nota.pageWidth']
    expect([prop.type, prop.default, prop.minimum, prop.maximum]).toEqual(['number', 85, 50, 100])
    const text = nls[prop.description.replace(/%/g, '')] as string
    expect(text).toMatch(/^Ширина страницы во вкладке Nota, в процентах от ширины вкладки/)
    expect(text).toMatch(/поле не меньше 80 px для ручек/)
    expect(json('package.nls.json')[prop.description.replace(/%/g, '')]).toMatch(/^Width of the page in a Nota tab, in percent of the tab width/)
  })

  it('nota.outlineView is capsule or side, capsule by default, labelled and described in Russian; the command is in the palette', () => {
    const nls = json('package.nls.ru.json')
    const pkg = json('package.json')
    const prop = pkg.contributes.configuration.properties['nota.outlineView']
    const text = (ref: string) => nls[ref.replace(/%/g, '')] as string
    expect([prop.type, prop.default, prop.enum]).toEqual(['string', 'capsule', ['capsule', 'side']])
    expect((prop.enumItemLabels as string[]).map(text)).toEqual(['Капсула', 'Сбоку'])
    expect((prop.enumDescriptions as string[]).map(text).every((t) => /[А-Яа-яЁё]/.test(t))).toBe(true)
    expect(text(prop.description)).toMatch(/^Как показывать оглавление «Разделы»/)
    expect(text(prop.description)).toMatch(/вместо неё сама появляется капсула/)
    const command = pkg.contributes.commands.find((c: { command: string }) => c.command === 'nota.toggleOutlineView')
    expect(text(command.title)).toBe('Nota: Переключить вид оглавления')
    const menu = pkg.contributes.menus.commandPalette.find((c: { command: string }) => c.command === 'nota.toggleOutlineView')
    expect(menu.when).toBe("activeCustomEditorId == 'nota.visual'")
  })

  it('nota.showAnchors is a boolean, false by default, described in Russian', () => {
    const nls = json('package.nls.ru.json')
    const prop = json('package.json').contributes.configuration.properties['nota.showAnchors']
    expect([prop.type, prop.default]).toEqual(['boolean', false])
    const text = nls[prop.description.replace(/%/g, '')] as string
    expect(text).toMatch(/^Показывать строки с якорями/)
    expect(text).toMatch(/В режиме «Текст» якоря видны всегда/)
  })

  it('nota.blocksInCapsule is all|frequent, all by default, described in Russian', () => {
    const nls = json('package.nls.ru.json')
    const prop = json('package.json').contributes.configuration.properties['nota.blocksInCapsule']
    expect([prop.type, prop.enum, prop.default]).toEqual(['string', ['all', 'frequent'], 'all'])
    expect(prop.enumItemLabels.map((d: string) => nls[d.replace(/%/g, '')])).toEqual(['Все блоки', 'Частые блоки'])
    expect(prop.enumDescriptions.map((d: string) => nls[d.replace(/%/g, '')])).toEqual([
      'Все 14 блоков значками и кнопками списков. По умолчанию.',
      '«Таблица», «Код», «Предупреждение», «Картинка» и списки, остальные — под «+».',
    ])
    expect(nls[prop.description.replace(/%/g, '')]).toMatch(/^Какие блоки стоят в капсуле, когда вкладка достаточно широкая/)
  })

  it('the command «Nota: Настройки» is in the palette in the tab of Nota only', () => {
    const pkg = json('package.json').contributes
    const nls = json('package.nls.ru.json')
    const cmd = pkg.commands.find((c: { command: string }) => c.command === 'nota.openSettings')
    expect(nls[cmd.title.replace(/%/g, '')]).toBe('Nota: Настройки')
    expect(cmd.title).toBe('%command.openSettings%')
    expect(json('package.nls.json')['command.openSettings']).toBe('Nota: Settings')
    const entry = pkg.menus.commandPalette.find((m: { command: string }) => m.command === 'nota.openSettings')
    expect(entry.when).toBe("activeCustomEditorId == 'nota.visual'")
  })

  it('the manifest is English, with a Russian file for a VS Code with the Russian language pack', () => {
    const nls = json('package.nls.json')
    const ruNls = json('package.nls.ru.json')
    expect(nls['command.strong']).toBe('Nota: Bold')
    expect(nls['customEditor.displayName']).toBe('Nota: Visual editor')
    expect(nls['command.toggleMode']).toBe('Nota: Text ⇄ Visual')
    expect(nls['command.openSettings']).toBe('Nota: Settings')
    expect(nls.description).toMatch(/^Visual AsciiDoc editor/)
    for (const value of Object.values(nls)) expect(value).not.toMatch(/[А-Яа-яЁё]/)
    expect(ruNls['command.strong']).toBe('Nota: жирный')
    expect(ruNls['customEditor.displayName']).toBe('Nota: визуальный редактор')
    expect(ruNls['command.toggleMode']).toBe('Nota: Текст ⇄ Визуально')
    expect(ruNls.description).toMatch(/^Визуальный редактор AsciiDoc/)
    expect(Object.keys(ruNls).sort()).toEqual(Object.keys(nls).sort())
    // VS Code takes package.nls.<language>.json: there is no other language file, and the Russian one has the right name
    expect(existsSync(join(dir, 'package.nls.en.json'))).toBe(false)
    expect(existsSync(join(dir, 'package.nls.ru.json'))).toBe(true)
  })

  it('every %key% of package.json is in both files of the manifest', () => {
    const used = [...readFileSync(join(dir, 'package.json'), 'utf8').matchAll(/"%([\w.]+)%"/g)].map((m) => m[1]!)
    expect(used.length).toBeGreaterThan(10)
    for (const file of ['package.nls.json', 'package.nls.ru.json']) for (const key of used) expect(json(file), `${file}: ${key}`).toHaveProperty(key)
  })

  it('the styles are commands with keys on a Mac only, in the tab of Nota', () => {
    const pkg = json('package.json').contributes
    const nls = json('package.nls.ru.json')
    const ids = ['nota.style.paragraph', 'nota.style.heading2', 'nota.style.heading3']
    expect(pkg.commands.filter((c: { command: string }) => ids.includes(c.command)).map((c: { title: string }) => nls[c.title.replace(/%/g, '')])).toEqual([
      'Nota: обычный текст',
      'Nota: заголовок 2',
      'Nota: заголовок 3',
    ])
    const binds = pkg.keybindings.filter((k: { command: string }) => ids.includes(k.command))
    expect(binds.map((k: { command: string; key: string }) => [k.command, k.key])).toEqual([
      ['nota.style.paragraph', 'cmd+alt+0'],
      ['nota.style.heading2', 'cmd+alt+2'],
      ['nota.style.heading3', 'cmd+alt+3'],
    ])
    for (const k of binds) {
      expect(k.when).toBe("isMac && activeCustomEditorId == 'nota.visual'")
      // (no key for Windows and Linux: Ctrl+Alt+digit is AltGr+digit on many keyboards)
      expect(k.mac).toBeUndefined()
    }
  })

  it('resolveLocale', () => {
    expect(resolveLocale('ru', 'en')).toBe('ru')
    expect(resolveLocale(undefined, 'en')).toBe('en')
    expect(resolveLocale(undefined, 'ru-RU')).toBe('ru')
    expect(resolveLocale('xx', 'de')).toBe('en')
    expect(resolveLocale(undefined, 'zh-cn')).toBe('en')
    expect(resolveLocale('garbage', 'en')).toBe('en')
    expect(resolveLocale('garbage', 'ru')).toBe('ru')
    expect(resolveLocale('en', 'ru')).toBe('en')
    expect(resolveLocale('auto', 'ru-RU')).toBe('ru')
    expect(resolveLocale('auto', 'en')).toBe('en')
    expect(resolveLocale('auto', 'de')).toBe('en')
  })
})

describe('the manifest: workspace capabilities', () => {
  // the extension reads and edits the open documents and lists files through vscode.workspace.fs; it runs no code from the workspace
  // (no processes, no settings read as commands), and the tab is a webview with a strict CSP
  it('declares that untrusted and virtual workspaces are supported', () => {
    const { capabilities } = json('package.json')
    expect(capabilities.untrustedWorkspaces).toEqual({ supported: true })
    expect(capabilities.virtualWorkspaces).toBe(true)
  })

  it('the host code starts no processes and reads no files directly', () => {
    const src = readdirSync(join(dir, 'src/host')).filter((f) => f.endsWith('.ts'))
    for (const f of src) {
      const text = readFileSync(join(dir, 'src/host', f), 'utf8')
      expect(text, f).not.toMatch(/child_process|node:fs|from 'fs'|createTerminal|\beval\(|new Function\(/)
    }
  })
})
