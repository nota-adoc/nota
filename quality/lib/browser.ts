import { builtinModules } from 'node:module'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'

export interface BrowserCheck {
  errors: string[]
  nodeBuiltins: string[]
  bytes: number
  gzipKB: number
}

const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])

/**
 * Bundles `entry` for the browser with esbuild (minified ESM) and reports errors, Node built-ins and gzip size;
 * the packages in `external` are left out of the bundle (the size of a package without what it builds on).
 */
export async function checkBrowserBundle(
  entry: string,
  opts: { external?: readonly string[] } = {},
): Promise<BrowserCheck> {
  const nodeBuiltins = new Set<string>()
  try {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      minify: true,
      write: false,
      logLevel: 'silent',
      external: [...(opts.external ?? [])],
      plugins: [
        {
          name: 'detect-node-builtins',
          setup(b) {
            b.onResolve({ filter: /.*/ }, (args) => {
              if (builtins.has(args.path)) {
                nodeBuiltins.add(args.path)
                return { path: args.path, external: true }
              }
              return undefined
            })
          },
        },
      ],
    })
    const code = result.outputFiles[0]!.contents
    return {
      errors: result.errors.map((e) => e.text),
      nodeBuiltins: [...nodeBuiltins],
      bytes: code.length,
      gzipKB: Math.round((gzipSync(code).length / 1024) * 10) / 10,
    }
  } catch (e) {
    const errors = (e as { errors?: { text: string }[] }).errors?.map((x) => x.text) ?? [String(e)]
    return { errors, nodeBuiltins: [...nodeBuiltins], bytes: 0, gzipKB: 0 }
  }
}

export interface BundleStats {
  /** Minified size of the bundle in bytes. */
  bytes: number
  /** Gzip size of the bundle in bytes. */
  gzipBytes: number
  /** Bytes in the minified bundle that come from each input file (absolute path → bytes), from esbuild's metafile. */
  inputs: Record<string, number>
}

/**
 * The same bundle as {@link checkBrowserBundle} (esbuild, browser, minified ESM), for the size report: `entry` is a file
 * (a path) or the source of a module (`{contents, resolveDir}`); the bytes of the bundle come from each input file.
 */
export async function bundleStats(
  entry: string | { contents: string; resolveDir: string },
  opts: { external?: readonly string[]; alias?: Record<string, string> } = {},
): Promise<BundleStats> {
  const result = await build({
    ...(typeof entry === 'string'
      ? { entryPoints: [entry] }
      : { stdin: { ...entry, loader: 'js' as const } }),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    minify: true,
    write: false,
    metafile: true,
    logLevel: 'silent',
    external: [...(opts.external ?? [])],
    alias: opts.alias ?? {},
  })
  const code = result.outputFiles[0]!.contents
  const out = Object.values(result.metafile.outputs)[0]!
  const inputs: Record<string, number> = {}
  for (const [path, v] of Object.entries(out.inputs)) inputs[path] = v.bytesInOutput
  return { bytes: code.length, gzipBytes: gzipSync(code).length, inputs }
}
