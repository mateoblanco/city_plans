/** URL pública del logo en R2: LOGO_BASE_URL + "/" + clave. null sin clave o sin la variable. */
export function logoUrl(key: string | null, base = process.env.LOGO_BASE_URL): string | null {
  const trimmed = base?.trim().replace(/\/+$/, '')
  return key && trimmed ? `${trimmed}/${key}` : null
}
