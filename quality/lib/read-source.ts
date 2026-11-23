import { readFileSync } from 'node:fs'

/** Reads a source file: UTF-16 with a byte order mark is decoded as such, anything else as UTF-8 (BOM kept). */
export function readSource(path: string): string {
  const buf = readFileSync(path)
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return decodeUtf16(buf, true)
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return decodeUtf16(buf, false)
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf)
}

function decodeUtf16(buf: Buffer, le: boolean): string {
  // String.fromCharCode keeps lone surrogates, which TextDecoder would replace
  let out = ''
  for (let i = 0; i + 1 < buf.length; i += 2)
    out += String.fromCharCode(le ? buf[i]! | (buf[i + 1]! << 8) : (buf[i]! << 8) | buf[i + 1]!)
  return out
}
