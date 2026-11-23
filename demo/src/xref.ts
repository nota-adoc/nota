// Targets of two documents that do not exist: what a host could give to the list after `xref:` and `<<`.
import type { XrefTarget } from '@nota-adoc/codemirror'
import { t } from './i18n.js'

const otherDocuments = (): readonly XrefTarget[] => [
  { id: 'guide.adoc#install', label: t('xref.install') },
  { id: 'guide.adoc#usage', label: t('xref.usage') },
  { id: 'reference.adoc#options', label: t('xref.options') },
  { id: 'reference.adoc#exit-codes', label: t('xref.exit-codes') },
]

/** Answers as a request to a server would, after a moment, from the list above; nothing is sent anywhere. */
export const xrefTargets = (query: string): Promise<readonly XrefTarget[]> =>
  new Promise((resolve) =>
    setTimeout(() => resolve(otherDocuments().filter((t) => query === '' || t.id.includes(query))), 30),
  )
