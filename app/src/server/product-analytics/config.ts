type Env = Record<string, string | undefined>

export type ProductAnalyticsConfig = { mode: 'off' } | { mode: 'send' | 'debug'; token: string }

/** Token de mentira del modo debug: Mixpanel lo pide para inicializar, y en debug nada se manda. */
export const DEBUG_TOKEN = 'debug'

/**
 * Analítica de producto (Mixpanel). `send` sólo en Production de Vercel (`VERCEL_ENV=production`, como ALLOW_INDEXING)
 * y con `MIXPANEL_TOKEN`. Fuera de producción, `MIXPANEL_DEBUG=true` carga Mixpanel igual pero sólo escribe en la
 * consola lo que mandaría (nunca envía, aunque haya token). Si no, apagada: el layout no monta ProductAnalytics y
 * Mixpanel nunca se baja. El token no lleva `NEXT_PUBLIC_`: el layout lo lee y se lo pasa al componente (el token de
 * proyecto de Mixpanel es público por diseño: viaja en cada evento). Se lee al renderizar el shell: cambiarlo requiere
 * un deploy nuevo.
 */
export function productAnalytics(env: Env = process.env): ProductAnalyticsConfig {
  const production = env.VERCEL_ENV?.trim() === 'production'
  const token = env.MIXPANEL_TOKEN?.trim()
  if (production) return token ? { mode: 'send', token } : { mode: 'off' }
  if (env.MIXPANEL_DEBUG?.trim().toLowerCase() === 'true') return { mode: 'debug', token: DEBUG_TOKEN }
  return { mode: 'off' }
}
