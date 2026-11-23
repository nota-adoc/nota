import type { Labels } from '@nota-adoc/prosemirror'
import type { Locale } from './locale.js'
import { messages } from './messages.js'

/** The words the editor shows around the text (the label of a checkbox, the types of admonitions, the title of a box, the names of the languages, the plates of images and islands) in this language: `createVisualEditor(el, { labels })`. */
export function editorLabels(locale: Locale): Required<Omit<Labels, 'pageMetaNote' | 'pageMetaTailNote' | 'pageMetaBodyNote' | 'tocNote' | 'pageMetaCollapse'>> {
  const t = messages[locale]
  return {
    checkItem: t.checkItem,
    details: t.details,
    admonition: t.admonitions,
    languages: t.languages,
    captionPlaceholder: t.captionPlaceholder,
    imageMissing: t.imageMissing('{path}'),
    imageRemote: t.imageRemote,
    islandNote: t.islandNote,
    anchorTip: t.anchorTip,
    islandUnsaved: t.islandUnsaved,
    diagramTitle: t.diagramTitle,
    diagramHint: t.diagramHint,
    diagramEditHint: t.diagramEditHint,
    diagramDrawing: t.diagramDrawing,
    diagramKept: t.diagramKept,
    diagramFailed: t.diagramFailed,
    diagramFailedHint: t.diagramFailedHint,
    diagramFailedBar: t.diagramFailedBar,
    diagramNoRenderer: t.diagramNoRenderer,
    diagramNoRendererHint: t.diagramNoRendererHint,
    diagramSample: t.diagramSample,
    gripColumn: t.gripColumn,
    gripRow: t.gripRow,
    gripBorder: t.gripBorder,
    widthLimit: t.widthLimit,
    tableScroll: t.tableScroll,
    gripColumns: t.gripColumns,
    gripRows: t.gripRows,
    barColBefore: t.barColBefore,
    barColAfter: t.barColAfter,
    barColDelete: t.barColDelete,
    barColsDelete: t.barColsDelete,
    barRowBefore: t.barRowBefore,
    barRowAfter: t.barRowAfter,
    barRowDelete: t.barRowDelete,
    barRowsDelete: t.barRowsDelete,
    widthFrame: t.widthFrame,
  }
}
