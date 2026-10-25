/** Minúsculas, sin tildes, palabras unidas con guiones; "lugar" si no queda nada. */
export function slugify(name: string) {
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'lugar'
}
