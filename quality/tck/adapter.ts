// The TCK adapter of nota: reads `{ contents, path, type }` as JSON from stdin and writes the ASG (JSON) to stdout.
// The TCK knows nothing of `range`, so it is left out.
import { parse } from '@nota-adoc/core'

export interface AdapterInput {
  contents: string
  path?: string
  type: 'block' | 'inline'
}

/** The ASG the TCK expects for a test: the document (`block`), or the inlines of a text (`inline`). */
export function adapt(input: AdapterInput): unknown {
  const doc = parse(input.contents)
  const asg = doc.asg()
  const result =
    input.type === 'inline'
      ? ((asg.blocks?.[0]?.['inlines'] as unknown[] | undefined) ?? [])
      : asg
  return JSON.parse(JSON.stringify(result, (k, v) => (k === 'range' ? undefined : v)))
}

async function main(): Promise<void> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as AdapterInput
  process.stdout.write(JSON.stringify(adapt(input)))
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e: unknown) => {
    console.error(e)
    process.exit(1)
  })
}
