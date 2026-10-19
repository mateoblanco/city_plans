import { describe, expect, it } from 'vitest'
import { FALLBACK_ICON_EMOJI, ICON_CATEGORIES, ICON_CATEGORY_KEYS, iconEmoji } from './icon-categories'

const graphemes = (text: string) => [...new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(text)]
const looksLikeEmoji = (emoji: string) => /^\p{Emoji_Presentation}$/u.test(emoji) || /^\p{Extended_Pictographic}️$/u.test(emoji)

describe('categorías de ícono', () => {
  it('son 45 categorías reales en snake_case, sin repetir y sin "other"', () => {
    expect(ICON_CATEGORY_KEYS).toHaveLength(45)
    expect(new Set(ICON_CATEGORY_KEYS).size).toBe(45)
    expect(ICON_CATEGORY_KEYS.every((key) => /^[a-z]+(?:_[a-z]+)*$/.test(key))).toBe(true)
    expect(ICON_CATEGORY_KEYS).not.toContain('other')
    expect(ICON_CATEGORIES.tapas).toEqual({ emoji: '🥘', description: 'Tapas, paella, cocina española' })
  })

  it('cada emoji es un solo grafema y se muestra como emoji (U+FE0F donde hace falta)', () => {
    for (const [key, { emoji, description }] of Object.entries(ICON_CATEGORIES)) {
      expect(graphemes(emoji), key).toHaveLength(1)
      expect(looksLikeEmoji(emoji), key).toBe(true)
      expect(description.trim(), key).not.toBe('')
    }
    expect(FALLBACK_ICON_EMOJI).toBe('\u{1F37D}️')
    expect(graphemes(FALLBACK_ICON_EMOJI)).toHaveLength(1)
    expect(looksLikeEmoji(FALLBACK_ICON_EMOJI)).toBe(true)
  })

  it('iconEmoji devuelve el emoji de la clave, o 🍽️ sin categoría o con una clave desconocida', () => {
    expect(iconEmoji('pizza')).toBe('🍕')
    expect(iconEmoji('tapas')).toBe('🥘')
    for (const key of [null, undefined, '', 'other', 'nope', 'constructor']) expect(iconEmoji(key)).toBe('🍽️')
  })
})
