// Sin crédito en el AI Gateway: lo comparten las guías y la extracción de lugares.

/** Dónde se carga crédito del AI Gateway (el dashboard elige el equipo). */
export const AI_CREDIT_URL = 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai'

/** Si el error (o lo que envuelve: cause, lastError, errors) es un 402 o "sin crédito" del AI Gateway. */
export function isNoCredit(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 4) return false
  const record = error as { statusCode?: unknown; status?: unknown; type?: unknown; message?: unknown; cause?: unknown; lastError?: unknown; errors?: unknown }
  if (record.statusCode === 402 || record.status === 402) return true
  if (typeof record.type === 'string' && /insufficient_funds|payment_required/.test(record.type)) return true
  if (typeof record.message === 'string' && /insufficient (funds|credit)|payment required|no credits?/i.test(record.message)) return true
  return [record.cause, record.lastError, ...(Array.isArray(record.errors) ? record.errors : [])].some((inner) => isNoCredit(inner, depth + 1))
}
