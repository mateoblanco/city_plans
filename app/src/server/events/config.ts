type Env = Record<string, string | undefined>

/**
 * Interruptor de los eventos de popularidad (TRACK_EVENTS). Apagado salvo que sea exactamente "true": en desarrollo y
 * previews no está, así que no se envía ni se guarda nada (ni se carga el código que envía). Sólo se prende en
 * Production de Vercel. Las páginas lo leen al renderizar el shell (que se prerenderiza): cambiarlo requiere un deploy
 * nuevo. /api/events lo vuelve a mirar en cada pedido.
 */
export const trackEvents = (env: Env = process.env) => env.TRACK_EVENTS?.trim().toLowerCase() === 'true'
