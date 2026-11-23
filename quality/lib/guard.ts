/**
 * Imported first by the tools that show what is in the files (`npm run compare`, `npm run ref`, `npm run dump`,
 * `quality/dev/`): when an argument is a folder with the `.aggregate-only` file, or lies in one, the tool exits
 * with 2 before it reads anything, and the message does not name the path.
 */
import { refuseAggregateOnly } from './aggregate.js'

refuseAggregateOnly(process.argv.slice(2).map((a) => a.replace(/^--[a-z-]+=/, '')))
