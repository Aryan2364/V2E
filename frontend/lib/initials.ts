/**
 * Up to two capital letters from a person's name, for avatars ("Asha Rao" ->
 * "AR", "Madonna" -> "M"). Falls back to "?" when there is no usable name.
 * Whitespace-tolerant. The one implementation; do not redefine it locally.
 */
export function getInitials(name?: string | null): string {
  if (!name) return '?'
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
  return letters || '?'
}
