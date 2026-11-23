// vitest globalSetup: fetches the ASG schema once, without blocking any worker.
import { prefetchSchema } from './schema.js'

export default async function setup(): Promise<void> {
  await prefetchSchema()
}
