import { SEARCH_CONFIG } from './config'

/** Forma canónica de una consulta: minúsculas, sin acentos, sin signos sueltos, máx. 200 caracteres. */
export function normalizeQuery(raw: string): string {
  return raw
    .slice(0, SEARCH_CONFIG.maxQueryLength * 2)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s'&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_CONFIG.maxQueryLength)
    .trim()
}

/** Palabras de la consulta aptas para to_tsquery: sólo letras y números. */
export function queryWords(normalized: string): string[] {
  return normalized.split(/[\s'&-]+/).filter((word) => /^[\p{L}\p{N}]+$/u.test(word))
}
