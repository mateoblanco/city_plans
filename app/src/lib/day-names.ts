/** Nombres de los días (0 = domingo), en el cliente y en el servidor (server/search/labels los reexporta). */
export const DAY_NAMES = {
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
} as const satisfies Record<'es' | 'en', readonly string[]>
