import '../lib/guard.js'
import { parse } from '../../packages/core/src/index.js'
import { formatTree } from '../lib/dump.js'
const text = JSON.parse(process.argv[2]!) as string
const d = parse(text)
process.stdout.write(formatTree(d))
