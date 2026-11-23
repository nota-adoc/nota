// A child process for chrome-leak.test.ts: starts a Chrome through the helper, prints one line, and then behaves as the mode says.
//   node --import tsx chrome-leak-child.ts <mode>, mode: wait | exit | hold:<ms>
import { findChrome, launchChrome } from './chrome.js'

const mode = process.argv[2] ?? 'wait'
const start = () => launchChrome({ chrome: findChrome()!, prefix: 'leak', args: ['--headless=new', '--disable-gpu', '--no-first-run', 'about:blank'] })
if (mode.startsWith('many:')) {
  // many:<n>:<ms>: n Chromes at once, each is held for ms
  const [, n, ms] = mode.split(':')
  await Promise.all(
    Array.from({ length: Number(n) }, async () => {
      const c = await start()
      console.log(`READY ${c.profile} ${c.proc.pid}`)
      await new Promise((r) => setTimeout(r, Number(ms)))
      await c.close()
    }),
  )
  console.log('DONE')
  process.exit(0)
}
if (mode === 'dump') {
  // the watchdog mode of chromeDump (`--dump-dom`, no pipe): the page of a server never ends, so Chrome stays alive
  const { createServer } = await import('node:http')
  // the server starts a page and never ends it: the load of the page does not finish
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.write('<html><body>start')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as { port: number }).port
  const page = `http://127.0.0.1:${port}/`
  const d = await launchChrome({ chrome: findChrome()!, prefix: 'leak', pipe: false, stdout: true, args: ['--headless=new', '--disable-gpu', '--no-first-run', '--dump-dom', page] })
  console.log(`READY ${d.profile} ${d.proc.pid}`)
  setInterval(() => {}, 1000)
  await new Promise(() => {})
}
const h = await start()
console.log(`READY ${h.profile} ${h.proc.pid}`)
if (mode === 'exit') process.exit(0)
if (mode.startsWith('hold:')) {
  await new Promise((r) => setTimeout(r, Number(mode.slice(5))))
  await h.close()
  console.log('DONE')
} else {
  setInterval(() => {}, 1000)
}
