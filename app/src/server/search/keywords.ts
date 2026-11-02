import { ALL_GROUPS, normalize, type TagGroup } from '@shared/tags.ts'

const SAFE_WORD = /^[a-z0-9]+$/

/**
 * Palabra → frases: las palabras que en el catálogo sólo aparecen dentro de sinónimos de varias palabras ("ver" → "ver
 * futbol", "ver el partido"…) y nunca como label o sinónimo de una sola. Sólo frases de letras y números: to_tsquery no
 * acepta el resto ("hi-fi", "lgbtq+").
 */
function buildPhraseOnlyWords(): Map<string, string[]> {
  const single = new Set<string>()
  const phrases = new Map<string, Set<string>>()
  for (const definitions of Object.values(ALL_GROUPS)) {
    for (const definition of Object.values(definitions as TagGroup)) {
      const names = [definition.label.es, definition.label.en, ...definition.synonyms.es, ...definition.synonyms.en, ...(definition.dishes?.es ?? []), ...(definition.dishes?.en ?? [])]
      for (const name of names) {
        const phrase = normalize(name).trim()
        const words = phrase.split(/\s+/).filter(Boolean)
        if (words.length === 1) single.add(words[0])
        else if (words.every((word) => SAFE_WORD.test(word))) {
          for (const word of words) phrases.set(word, (phrases.get(word) ?? new Set()).add(phrase))
        }
      }
    }
  }
  return new Map([...phrases].filter(([word]) => !single.has(word)).map(([word, found]) => [word, [...found]]))
}

const PHRASE_ONLY_WORDS = buildPhraseOnlyWords()

/**
 * Filtro para que un sinónimo de varias palabras coincida como frase completa y no por una palabra suelta: "ver" en la
 * consulta no engancha con "ver fútbol" de watch_football. keyword_text repite los sinónimos, así que se resuelve al
 * consultar: una keyword que sólo existe dentro de frases, y sin ninguna de ellas pedida, exige que el lugar no tenga la
 * frase. null si ninguna keyword está en ese caso.
 */
export function keywordFilter(keywords: string[], normalized: string): string | null {
  const text = ` ${normalized} `
  const asked = new Set(keywords)
  const guarded = (word: string) => {
    const phrases = PHRASE_ONLY_WORDS.get(word)
    if (!phrases) return null
    // Pedida en el texto o armada por las keywords (un plato del modelo: "milanga napolitana" → milanesa, napolitana).
    return phrases.some((phrase) => text.includes(` ${phrase} `) || phrase.split(' ').every((part) => asked.has(part))) ? null : phrases
  }
  if (!keywords.some(guarded)) return null
  return keywords
    .map((word) => {
      const phrases = guarded(word)
      return phrases ? `(${word} & ${phrases.map((phrase) => `!(${phrase.split(' ').join(' <-> ')})`).join(' & ')})` : word
    })
    .join(' | ')
}
