/**
 * The renderer of diagrams for the tab: `mermaid` (strict: no scripts, no `click`, the labels cleaned), loaded from its own file when
 * the first diagram is shown, drawn in the colours of the theme of the tab. Nothing is fetched from the network.
 */
import { type DiagramRenderer, type DiagramTheme, RendererMissing } from '@nota-adoc/prosemirror'

/** What the tab uses of the library. */
interface MermaidApi {
  initialize(config: Record<string, unknown>): void
  render(id: string, text: string): Promise<{ svg: string }>
}

const GLOBAL = '__notaMermaid'

/** The colours a theme falls back on when the tokens of the page are not there (a test page). */
const FALLBACK: Record<DiagramTheme, Record<string, string>> = {
  light: { paper: '#ffffff', ink: '#1d1f24', muted: '#5b6270', accent: '#4f46e5', soft: '#eceafd', rule: '#d4d7de' },
  dark: { paper: '#1e1e1e', ink: '#e6e8ee', muted: '#b4b9c4', accent: '#8b84ff', soft: '#2b2a4a', rule: '#4a4f5b' },
}

/** The variables of the theme of mermaid, from the tokens `--ap-*` of the tab. */
export function themeVariables(doc: Document, theme: DiagramTheme): Record<string, unknown> {
  const style = doc.defaultView?.getComputedStyle(doc.body)
  const token = (name: string, fallback: string): string => style?.getPropertyValue(name).trim() || fallback
  const f = FALLBACK[theme]
  const paper = token('--ap-paper', f.paper!)
  const ink = token('--ap-ink', f.ink!)
  const muted = token('--ap-ink-muted', f.muted!)
  const accent = token('--ap-accent', f.accent!)
  const soft = token('--ap-accent-soft', f.soft!)
  const rule = token('--ap-rule-strong', f.rule!)
  return {
    darkMode: theme === 'dark',
    background: paper,
    fontFamily: token('--ap-font-ui', 'system-ui, sans-serif'),
    primaryColor: soft,
    primaryBorderColor: accent,
    primaryTextColor: ink,
    secondaryColor: paper,
    secondaryBorderColor: rule,
    secondaryTextColor: ink,
    tertiaryColor: paper,
    tertiaryBorderColor: rule,
    tertiaryTextColor: ink,
    lineColor: muted,
    textColor: ink,
    mainBkg: soft,
    nodeBorder: accent,
    nodeTextColor: ink,
    clusterBkg: paper,
    clusterBorder: rule,
    edgeLabelBackground: paper,
    titleColor: ink,
    noteBkgColor: soft,
    noteBorderColor: accent,
    noteTextColor: ink,
    actorBkg: soft,
    actorBorder: accent,
    actorTextColor: ink,
    actorLineColor: muted,
    signalColor: muted,
    signalTextColor: ink,
    labelBoxBkgColor: soft,
    labelBoxBorderColor: accent,
    labelTextColor: ink,
    loopTextColor: ink,
  }
}

/**
 * The picture without what a click or a load could do: the links of the `click` lines are taken out (the text of the node stays), as are
 * pictures and the handlers of events. Strict mode of mermaid keeps the links.
 */
export function inert(doc: Document, svg: string): string {
  const box = doc.createElement('template')
  box.innerHTML = svg
  for (const a of Array.from(box.content.querySelectorAll('a'))) a.replaceWith(...Array.from(a.childNodes))
  for (const el of Array.from(box.content.querySelectorAll('img, image, picture, video, audio, source, track, iframe, object, embed, script'))) el.remove()
  for (const el of Array.from(box.content.querySelectorAll('*')))
    for (const attr of Array.from(el.attributes)) {
      const link = attr.name === 'href' || attr.name === 'xlink:href'
      // (a reference to a part of the picture itself, `#id`, stays)
      const loads = attr.name === 'src' || attr.name === 'srcset' || attr.name === 'poster'
      if (/^on/i.test(attr.name) || loads || (link && !attr.value.startsWith('#'))) el.removeAttribute(attr.name)
    }
  return box.innerHTML
}

/**
 * @param url the address of `dist/mermaid.js` in the webview; without it, or when the file does not open, no diagram is drawn
 * @param nonce the nonce of the page: the script of the library carries it
 */
export function createMermaidRenderer(doc: Document, url: string | undefined, nonce: string | undefined): DiagramRenderer {
  let loading: Promise<MermaidApi> | null = null
  const load = (): Promise<MermaidApi> => {
    if (loading) return loading
    loading = new Promise<MermaidApi>((resolve, reject) => {
      const win = doc.defaultView as (Window & { [GLOBAL]?: MermaidApi }) | null
      if (win?.[GLOBAL]) return resolve(win[GLOBAL]!)
      if (!url) return reject(new RendererMissing())
      const script = doc.createElement('script')
      if (nonce) script.nonce = nonce
      script.src = url
      script.addEventListener('load', () => {
        const api = win?.[GLOBAL]
        if (api) resolve(api)
        else reject(new RendererMissing())
      })
      script.addEventListener('error', () => reject(new RendererMissing()))
      doc.head.append(script)
    })
    return loading
  }

  // (mermaid draws one diagram at a time: it measures them in the page)
  let queue: Promise<unknown> = Promise.resolve()
  let counter = 0

  return (code, theme) => {
    const task = queue.then(async () => {
      const mermaid = await load()
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: themeVariables(doc, theme),
        fontFamily: String(themeVariables(doc, theme).fontFamily),
        // nothing in a label may make a request or a link: no pictures, no addresses (the strict level keeps `<img src>` and the `click` links)
        dompurifyConfig: { FORBID_TAGS: ['img', 'picture', 'source', 'video', 'audio', 'track', 'iframe', 'object', 'embed', 'link', 'a', 'form'], FORBID_ATTR: ['src', 'srcset', 'poster', 'href', 'xlink:href', 'action'] },
        // (the code of a diagram may carry `%%{init: …}%%`: these settings are not for it to change)
        secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'dompurifyConfig'],
        suppressErrorRendering: true,
        logLevel: 5,
      })
      const id = `nota-diagram-${++counter}`
      try {
        return inert(doc, (await mermaid.render(id, code)).svg)
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : String(e), { cause: e })
      } finally {
        // (a failed drawing may leave its work in the page)
        doc.getElementById(id)?.remove()
        doc.getElementById(`d${id}`)?.remove()
      }
    })
    queue = task.catch(() => undefined)
    return task
  }
}
