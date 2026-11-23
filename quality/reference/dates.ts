/**
 * The dates and times the HTML of the comparison is written with, on all three sides (the same values are in
 * ruby/dump.rb). Asciidoctor reads the clock for `{docyear}` and the like, Nota sets them only when it is told to,
 * so the comparison tells all of them the same values.
 */
export const FIXED_DATES: Record<string, string> = {
  localdate: '2000-01-02',
  localyear: '2000',
  localtime: '03:04:05 +0000',
  localdatetime: '2000-01-02 03:04:05 +0000',
  docdate: '2000-01-02',
  docyear: '2000',
  doctime: '03:04:05 +0000',
  docdatetime: '2000-01-02 03:04:05 +0000',
}
