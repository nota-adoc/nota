import { CELL_FILL_ROLES, FILL_ROLES, TEXT_COLOR_ROLES } from '@nota-adoc/prosemirror'

export { CELL_FILL_ROLES, FILL_ROLES, TEXT_COLOR_ROLES }

/** The CSS variable with the colour of a role: the swatches and the stripe on the icon use it. */
export const ROLE_VAR: Readonly<Record<string, string>> = {
  'hl-red': '--ap-tx-red',
  'hl-blue': '--ap-tx-blue',
  'hl-orange': '--ap-tx-orange',
  'hl-purple': '--ap-tx-purple',
  'hl-pink': '--ap-tx-pink',
  'hl-teal': '--ap-tx-teal',
  'hl-green': '--ap-tx-green',
  'hl-gray': '--ap-tx-gray',
  'hl-yellow-bg': '--ap-hl-yellow',
  'hl-red-bg': '--ap-hl-red',
  'hl-orange-bg': '--ap-hl-orange',
  'hl-green-bg': '--ap-hl-green',
  'hl-teal-bg': '--ap-hl-teal',
  'hl-blue-bg': '--ap-hl-blue',
  'hl-pink-bg': '--ap-hl-pink',
  'hl-purple-bg': '--ap-hl-purple',
  'hl-gray-bg': '--ap-hl-gray',
  'cell-yellow': '--ap-hl-yellow',
  'cell-green': '--ap-hl-green',
  'cell-blue': '--ap-hl-blue',
  'cell-pink': '--ap-hl-pink',
  'cell-purple': '--ap-hl-purple',
  'cell-gray': '--ap-hl-gray',
}

/** The roles of a family among `roles`, the first one or null. */
export const familyRole = (family: readonly string[], roles: readonly string[]): string | null =>
  roles.find((r) => family.includes(r)) ?? null

/** How a piece with these roles is written in the text: `[.hl-red.hl-yellow-bg]#…#`. */
export function roleSource(roles: readonly string[]): string {
  return roles.length === 0 ? '' : `[.${roles.join('.')}]#…#`
}

