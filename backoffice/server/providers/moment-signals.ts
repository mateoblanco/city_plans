import { isOccasionTag, OCCASION_TAGS, type OccasionTag } from '../../src/data/tags.ts'
import { hasPhrase } from './source-hosts.ts'

/**
 * Señales concretas con las que el código acepta un momento (goodFor) o un style inferido: el modelo propone el
 * tag y cita facts; el tag queda sólo si esos facts traen la señal. all es una lista de "cualquiera de": todas
 * tienen que aparecer en el mismo fact ("tabla" y "compartir"). Frases de una misma señal cuentan una vez.
 */
export type Signal = { id: string; strength: 'strong' | 'weak'; all: string[][] }

const strong = (id: string, ...all: string[][]): Signal => ({ id, strength: 'strong', all })
const weak = (id: string, ...all: string[][]): Signal => ({ id, strength: 'weak', all })

export const MOMENT_IDS = OCCASION_TAGS
export type MomentId = OccasionTag
export const isMomentId = isOccasionTag

/** Una señal fuerte alcanza sola; las débiles necesitan otra débil distinta del mismo momento. */
export const MOMENT_SIGNALS: Record<MomentId, Signal[]> = {
  groups: [
    strong('picada para compartir', ['picada', 'picadas', 'picadita', 'tabla', 'tablas'], ['compartir', 'to share', 'sharing']),
    weak('tapas para compartir', ['tapas', 'platitos', 'platos pequeños', 'small plates'], ['compartir', 'to share', 'sharing']),
    weak('cerveza tirada', ['cerveza tirada', 'chopp', 'chopera', 'canillas de cerveza', 'draft beer', 'beer on tap']),
    weak('tragos', ['tragos', 'cócteles', 'cocteles', 'coctelería', 'cocktails']),
    weak('ambiente animado', ['animado', 'animada', 'con onda', 'movido', 'bullicioso', 'lively']),
    weak('música', ['música en vivo', 'bandas en vivo', 'bandas', 'toques', 'toques en vivo', 'shows en vivo', 'dj', 'djs', 'live music']),
    weak('mesas grandes', ['mesas grandes', 'mesa grande', 'mesas largas', 'mesa larga', 'mesas comunitarias', 'large tables', 'long tables']),
  ],
  date: [
    weak('ambiente tranquilo', ['tranquilo', 'tranquila', 'silencioso', 'calmo', 'quiet']),
    weak('íntimo', ['íntimo', 'íntima', 'intimo', 'intimate', 'luz tenue', 'velas']),
    weak('vinos', ['vinos', 'vino', 'carta de vinos', 'copa de vino', 'wine', 'wine list']),
    weak('cocina cuidada', ['de autor', 'cocina cuidada', 'menú de pasos', 'menú degustación', 'tasting menu', 'chef']),
    weak('reservas', ['reserva', 'reservas', 'reservar', 'reservation', 'reservations']),
    // Sólo suma a date: cozy sigue exigiendo la mención explícita en la fuente.
    weak('acogedor', ['acogedor', 'acogedora', 'cozy', 'cosy']),
  ],
  kids_friendly: [
    strong('menú infantil', ['menú infantil', 'menú para niños', 'menú kids', 'kids menu']),
    strong('sillas altas', ['sillas altas', 'silla alta', 'sillitas para bebés', 'high chairs', 'high chair']),
    strong('juegos para niños', ['juegos para niños', 'juegos infantiles', 'espacio para niños', 'zona infantil', 'área infantil', 'playground', 'kids area']),
    weak('patio', ['patio', 'jardín', 'garden']),
    weak('espacio amplio', ['amplio', 'amplia', 'espacioso', 'spacious']),
    // No "familiar" suelto: "emprendimiento familiar" no dice nada de los chicos.
    weak('propuesta familiar', ['propuesta familiar', 'ambiente familiar', 'para toda la familia', 'para familias', 'family friendly', 'families']),
  ],
  celebration: [
    strong('eventos privados', ['eventos privados', 'evento privado', 'fiestas privadas', 'private events', 'private event']),
    strong('salón para eventos', ['salón para eventos', 'salón de eventos', 'salón privado', 'event space', 'private room']),
    weak('reservas para grupos', ['reservas para grupos', 'reserva para grupos', 'grupos grandes', 'group reservations', 'large groups']),
    weak('tragos', ['tragos', 'cócteles', 'cocteles', 'coctelería', 'espumante', 'champagne', 'cocktails']),
    // No "especial" suelto: "pizza especial" no es una ocasión.
    weak('lugar especial', ['lugar especial', 'ocasión especial', 'ocasiones especiales', 'noche especial', 'fecha especial', 'special occasion']),
  ],
  quick: [
    strong('al paso', ['al paso', 'grab and go']),
    // Débil: en muchos cafés se pide en el mostrador y se come ahí.
    weak('mostrador', ['mostrador', 'en la barra para pedir', 'counter service']),
    weak('para llevar', ['para llevar', 'take away', 'takeaway', 'to go']),
    weak('menú del día', ['menú del día', 'menú ejecutivo', 'plato del día', 'set lunch']),
  ],
}

/**
 * Señales que no cuentan cuando el código deduce un momento que el modelo no propuso: son tan comunes que, con
 * cualquier otra débil, darían el momento en casi todos los lugares (aceptar reservas no hace a un lugar de cita; en
 * muchos cafés se pide en el mostrador y se come ahí).
 */
export const NOT_FOR_DEDUCTION: Partial<Record<MomentId, string[]>> = { date: ['reservas'], quick: ['mostrador'] }

export type StyleSignalId = 'casual' | 'cuidado'

/** casual y cuidado necesitan una señal fuerte o dos débiles en facts citados; intermedio sólo necesita facts. */
export const STYLE_SIGNALS: Record<StyleSignalId, Signal[]> = {
  casual: [
    strong('por porción', ['por porción', 'por porciones', 'por porcion', 'by the slice']),
    strong('al paso', ['al paso', 'grab and go']),
    strong('mostrador', ['mostrador', 'counter service']),
    strong('de barrio', ['de barrio', 'barrial', 'neighborhood']),
    strong('informal', ['informal', 'descontracturado', 'descontracturada', 'sencillo', 'sencilla', 'casual']),
    strong('bodegón', ['bodegón', 'bodegon', 'boliche de barrio']),
    weak('hamburguesería', ['hamburguesería', 'hamburgueseria', 'burger joint']),
    weak('panchería', ['panchería', 'pancheria', 'panchos']),
    weak('rotisería', ['rotisería', 'rotiseria', 'rotisserie']),
    weak('combos', ['combo', 'combos']),
    weak('abundante', ['abundante', 'abundantes', 'porciones grandes', 'generous portions']),
    weak('precios accesibles', ['precios accesibles', 'precio accesible', 'precios económicos', 'precios bajos', 'affordable']),
    weak('ambiente relajado', ['ambiente relajado', 'relajado', 'relajada', 'relaxed', 'laid-back']),
  ],
  cuidado: [
    strong('de autor', ['de autor', 'chef-driven', 'signature cuisine']),
    strong('menú de pasos', ['menú de pasos', 'menú degustación', 'menu degustacion', 'tasting menu']),
    strong('carta de vinos', ['carta de vinos', 'wine list', 'maridaje', 'pairing']),
    // Débil: muchos bares concurridos piden reservar sin ser un lugar cuidado.
    weak('reservas recomendadas', ['reservas recomendadas', 'se recomienda reservar', 'imprescindible reservar', 'reservation recommended', 'reservations recommended']),
    strong('elegante', ['elegante', 'sofisticado', 'sofisticada', 'refinado', 'refinada', 'elegant', 'upscale', 'refined']),
  ],
}

/** Una señal aparece en el texto si cada una de sus partes aparece como frase completa. */
export function signalIn(signal: Signal, text: string) {
  return signal.all.every((options) => options.some((phrase) => hasPhrase(text, phrase)))
}

/** fromSummary: la señal salió del resumen de Exa; cuenta como débil y nunca alcanza sola. */
export type SignalMatch = { signal: string; strength: Signal['strength']; factId: string; fromSummary?: boolean }

/** Primera aparición de cada señal en los facts, en orden de los facts. */
export function signalsIn(signals: Signal[], facts: { id: string; text: string }[]): SignalMatch[] {
  return signals.flatMap((signal) => {
    const fact = facts.find((item) => signalIn(signal, item.text))
    return fact ? [{ signal: signal.id, strength: signal.strength, factId: fact.id }] : []
  })
}

/**
 * Alcanza una señal fuerte o dos débiles distintas. Devuelve las que la justifican, o null si no alcanza.
 * summary: señales del resumen de Exa. Cuentan como débiles (aunque sean fuertes) y sólo suman a una señal de
 * otra fuente; una señal que ya está en las fuentes propias no se cuenta dos veces.
 */
export function sufficientSignals(matches: SignalMatch[], summary: SignalMatch[] = []): SignalMatch[] | null {
  const strongMatch = matches.find((match) => match.strength === 'strong')
  if (strongMatch) return [strongMatch]
  const weakMatches = matches.filter((match) => match.strength === 'weak')
  if (weakMatches.length >= 2) return weakMatches.slice(0, 2)
  const own = new Set(matches.map((match) => match.signal))
  const fromSummary = summary.filter((match) => !own.has(match.signal)).map((match) => ({ ...match, strength: 'weak' as const, fromSummary: true }))
  return weakMatches.length === 1 && fromSummary.length > 0 ? [weakMatches[0], fromSummary[0]] : null
}
