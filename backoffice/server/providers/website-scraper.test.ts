import { describe, expect, it } from 'vitest'
import {
  assertPublicHttpUrl,
  isBlockedIp,
  normalizeInstagramProfileUrl,
  normalizeWebsitePageData,
} from './website-scraper.ts'

describe('website scraper', () => {
  it('bloquea hosts e IPs privados antes de abrir el navegador', async () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true)
    expect(isBlockedIp('10.10.0.1')).toBe(true)
    expect(isBlockedIp('::1')).toBe(true)
    expect(isBlockedIp('8.8.8.8')).toBe(false)

    await expect(assertPublicHttpUrl('http://localhost/admin')).rejects.toMatchObject({
      kind: 'upstream',
    })
    await expect(assertPublicHttpUrl(
      'https://example.com',
      async () => [{ address: '192.168.1.2' }],
    )).rejects.toMatchObject({ kind: 'upstream' })
  })

  it('acepta sólo URLs de perfiles de Instagram', () => {
    expect(normalizeInstagramProfileUrl('https://instagram.com/cafe.uy/?hl=es')).toBe(
      'https://www.instagram.com/cafe.uy/',
    )
    expect(normalizeInstagramProfileUrl('https://instagram.com/p/ABC123')).toBeNull()
    expect(normalizeInstagramProfileUrl('https://example.com/cafe')).toBeNull()
  })

  it('limpia, deduplica y limita el contenido renderizado', () => {
    const result = normalizeWebsitePageData('https://cafe.example/', {
      title: '  Café   Central  ',
      description: 'Café de especialidad',
      content: `Primera línea\nPrimera línea\n${'x'.repeat(30_000)}`,
      links: [
        'https://instagram.com/cafe.central',
        'https://www.instagram.com/cafe.central/',
        'https://instagram.com/p/post',
      ],
      structured: [{ '@type': 'Restaurant', servesCuisine: 'Café' }],
    })

    expect(result.title).toBe('Café Central')
    expect(result.content.length).toBeLessThanOrEqual(25_000)
    expect(result.content.match(/Primera línea/g)).toHaveLength(1)
    expect(result.instagramUrls).toEqual(['https://www.instagram.com/cafe.central/'])
  })
})
