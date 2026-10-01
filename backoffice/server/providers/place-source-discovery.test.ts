import { describe, expect, it } from 'vitest'
import {
  assessInstagramCandidate,
  assessWebsiteCandidate,
  instagramFallbackSearchQuery,
  instagramSearchQuery,
  normalizeWebsiteCandidateUrl,
  websiteSearchQuery,
} from './place-source-discovery.ts'

const anchor = {
  name: 'Café Central',
  address: 'Avenida 18 de Julio 1234, Montevideo, Uruguay',
  latitude: -34.9,
  longitude: -56.16,
}

const searchResult = {
  url: 'https://cafe.example/',
  title: 'Café Central',
  description: 'Café de especialidad',
  position: 1,
}

describe('descubrimiento de fuentes', () => {
  it('construye consultas acotadas y excluye plataformas no oficiales', () => {
    expect(websiteSearchQuery(anchor)).toContain('Café Central Avenida 18 de Julio 1234')
    expect(websiteSearchQuery(anchor)).not.toContain('11200')
    expect(websiteSearchQuery(anchor)).toContain('-site:instagram.com')
    expect(instagramSearchQuery(anchor)).toBe('Café Central')
    expect(instagramFallbackSearchQuery(anchor)).toBe(
      'Café Central Montevideo Uruguay',
    )
    expect(normalizeWebsiteCandidateUrl('https://instagram.com/cafe/')).toBeNull()
    expect(normalizeWebsiteCandidateUrl('https://restaurantguru.com/cafe')).toBeNull()
    expect(normalizeWebsiteCandidateUrl(
      'https://fr.tripadvisor.ch/Restaurant_Review-g1-cafe.html',
    )).toBeNull()
    expect(normalizeWebsiteCandidateUrl('https://wanderlog.com/place/details/123')).toBeNull()
    expect(normalizeWebsiteCandidateUrl('http://127.0.0.1/admin')).toBeNull()
    expect(normalizeWebsiteCandidateUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeWebsiteCandidateUrl('https://cafe.example/?utm_source=x#menu')).toBe(
      'https://cafe.example/',
    )
  })

  it('no exige la dirección completa de Google como frase literal', () => {
    const olisa = {
      ...anchor,
      name: 'Olisa Café',
      address: 'Av. Gonzalo Ramírez 2086, 11200 Montevideo, Departamento de Montevideo',
    }

    expect(websiteSearchQuery(olisa)).toBe(
      'Olisa Café Av. Gonzalo Ramírez 2086 Montevideo Uruguay -site:instagram.com -site:facebook.com',
    )
    expect(instagramSearchQuery(olisa)).toBe('Olisa Café')
    expect(instagramFallbackSearchQuery(olisa)).toBe(
      'Olisa Café Montevideo Uruguay',
    )
  })

  it('acepta automáticamente una web sólo con nombre más ubicación o enlace cruzado', () => {
    const page = {
      url: 'https://cafe.example/',
      title: 'Café Central',
      description: '',
      content: 'Estamos en 18 de Julio 1234, Montevideo.',
      instagramUrls: [],
    }
    expect(assessWebsiteCandidate(anchor, searchResult, page, null)?.autoAccept).toBe(true)

    const ambiguous = assessWebsiteCandidate(
      anchor,
      searchResult,
      { ...page, content: 'Café de especialidad.', instagramUrls: [] },
      null,
    )
    expect(ambiguous).toMatchObject({
      autoAccept: false,
      candidate: { confidence: 'medium' },
    })

    const crossLinked = assessWebsiteCandidate(
      anchor,
      { ...searchResult, title: 'Inicio' },
      {
        ...page,
        title: 'Inicio',
        content: '',
        instagramUrls: ['https://www.instagram.com/cafe.central/'],
      },
      'https://www.instagram.com/cafe.central/',
    )
    expect(crossLinked?.autoAccept).toBe(true)
  })

  it('no confunde una agenda o artículo que menciona el lugar con su web oficial', () => {
    const result = {
      url: 'https://www.wineriesofuruguay.com/agenda/2026-06',
      title: 'Agenda',
      description: 'La Vermutería invita a una noche especial en Miñones 455, Montevideo.',
      position: 1,
    }
    const page = {
      url: result.url,
      title: 'Agenda de junio',
      description: 'Eventos y novedades',
      content: result.description,
      instagramUrls: ['https://www.instagram.com/vitibardevinos/'],
    }
    const vermuteria = {
      ...anchor,
      name: 'Vermutería',
      address: 'Miñones 455, Montevideo',
    }

    expect(assessWebsiteCandidate(vermuteria, result, page, null)).toMatchObject({
      autoAccept: false,
      candidate: {
        title: 'Agenda de junio',
        evidence: [
          'El contenido menciona el nombre del local.',
          'La dirección o localidad coincide.',
        ],
      },
    })
  })

  it('acepta Instagram por ubicación o por enlace al dominio confirmado', () => {
    const profile = {
      url: 'https://www.instagram.com/cafe.central/',
      name: 'Café Central',
      bio: '18 de Julio 1234, Montevideo',
      links: [],
    }
    expect(assessInstagramCandidate(anchor, searchResult, profile, null)?.autoAccept).toBe(true)

    const crossLinked = assessInstagramCandidate(
      anchor,
      { ...searchResult, title: 'Instagram' },
      {
        ...profile,
        name: 'Otra presentación',
        bio: '',
        links: ['https://www.cafe.example/reservas'],
      },
      'https://cafe.example/',
    )
    expect(crossLinked?.autoAccept).toBe(true)
  })

  it('no asocia otro bar porque Google mencione una categoría genérica', () => {
    const vermuteria = {
      ...anchor,
      name: 'Vermutería',
      address: 'Miñones 455, Montevideo',
    }
    const result = {
      ...searchResult,
      title: 'Viti Bar de Vinos',
      description: 'Una vermutería en Montevideo',
    }
    const profile = {
      url: 'https://www.instagram.com/vitibardevinos/',
      name: 'Viti Bar de Vinos',
      bio: 'Bar de vinos · Colón 1543 · Montevideo',
      links: ['https://vitibardevinos.uy/'],
    }

    expect(assessInstagramCandidate(vermuteria, result, profile, null)).toMatchObject({
      autoAccept: false,
      candidate: { confidence: 'low' },
    })
  })
})
