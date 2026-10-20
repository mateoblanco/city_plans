import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import {
  classifyProfilePicture,
  extractLogoColors,
  fetchPlaceLogo,
  GENERIC_AVATAR_HASHES,
  hashDistance,
  imageHash,
  isGenericAvatarHash,
  profilePictureStatus,
  type LogoDeps,
} from './place-logo.ts'

const svg = (body: string, size = 320) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`)
const png = (body: string, size = 320) => sharp(svg(body, size)).png().toBuffer()

async function colorsOf(image: Buffer) {
  const raw = await sharp(image).resize(128, 128, { fit: 'cover' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return extractLogoColors(raw.data, raw.info.width, raw.info.height)
}

const profile = { url: 'https://www.instagram.com/cafe/', name: 'Café', bio: '', links: [], profilePicUrl: 'https://cdn.example/cafe-hd.jpg' }

function deps(image: Buffer | Response, overrides: Partial<LogoDeps> = {}): LogoDeps {
  return {
    storage: { configured: true, put: vi.fn(async () => {}) },
    classify: vi.fn(async () => ({ kind: 'logo' as const, inputTokens: 900, outputTokens: 8, gatewayCostUsd: null })),
    model: 'anthropic/claude-haiku-5.5',
    fetcher: vi.fn(async () => image instanceof Response ? image : new Response(new Uint8Array(image), { status: 200 })) as never,
    now: () => new Date('2026-10-16T12:00:00.000Z'),
    ...overrides,
  }
}

describe('colores del logo', () => {
  it('fondo blanco con un círculo rojo: el fondo es blanco y el principal, rojo', async () => {
    const image = await png('<rect width="320" height="320" fill="#ffffff"/><circle cx="160" cy="160" r="100" fill="#c0392b"/>')
    expect(await colorsOf(image)).toEqual({ bgColor: '#ffffff', color: '#c0392b' })
  })

  it('con un borde transparente no hay fondo', async () => {
    const image = await png('<circle cx="160" cy="160" r="120" fill="#1e6fd9"/>')
    expect(await colorsOf(image)).toEqual({ bgColor: null, color: '#1e6fd9' })
  })

  it('con un borde muy variado (una foto) no hay fondo', async () => {
    const stripes = Array.from({ length: 8 }, (_, index) =>
      `<rect x="${index * 40}" width="40" height="320" fill="${['#e74c3c', '#2ecc71', '#3498db', '#f1c40f'][index % 4]}"/>`).join('')
    expect((await colorsOf(await png(stripes))).bgColor).toBeNull()
  })

  it('ignora negros y grises si hay un color con saturación, aunque ocupe menos', async () => {
    const image = await png('<rect width="320" height="320" fill="#ffffff"/><rect x="40" y="40" width="240" height="160" fill="#111111"/><rect x="40" y="220" width="240" height="40" fill="#2a9d4b"/>')
    expect(await colorsOf(image)).toEqual({ bgColor: '#ffffff', color: '#2a9d4b' })
  })

  it('texto blanco suavizado sobre un fondo de color: el principal es el blanco, no los bordes', async () => {
    const letters = Array.from({ length: 6 }, (_, index) => `<rect x="${40 + index * 42}" y="90" width="14" height="140" fill="#ffffff"/>`).join('')
    const image = await sharp(svg(`<rect width="320" height="320" fill="#011f5d"/>${letters}`)).blur(1.5).png().toBuffer()
    expect(await colorsOf(image)).toEqual({ bgColor: '#011f5d', color: '#ffffff' })
  })

  it('una imagen toda en grises guarda el gris más presente', async () => {
    const image = await png('<rect width="320" height="320" fill="#f2f2f2"/><rect x="40" y="40" width="240" height="180" fill="#333333"/><rect x="40" y="230" width="240" height="40" fill="#999999"/>')
    expect(await colorsOf(image)).toEqual({ bgColor: '#f2f2f2', color: '#333333' })
  })
})

describe('avatar genérico', () => {
  it('compara la miniatura de 8×8 en grises, tolerando la recodificación del CDN', async () => {
    const avatar = await png('<rect width="320" height="320" fill="#dbdbdb"/><circle cx="160" cy="125" r="55" fill="#ffffff"/><ellipse cx="160" cy="300" rx="110" ry="90" fill="#ffffff"/>')
    const reference = await imageHash(avatar)
    const recoded = await sharp(avatar).resize(150, 150).jpeg({ quality: 60 }).toBuffer()
    const other = await imageHash(await png('<rect width="320" height="320" fill="#dbdbdb"/><circle cx="160" cy="160" r="90" fill="#c0392b"/>'))

    expect(hashDistance('00ff', '0aff')).toBe(5)
    expect(isGenericAvatarHash(await imageHash(recoded), [reference])).toBe(true)
    expect(isGenericAvatarHash(other, [reference])).toBe(false)
  })

  it('la referencia real detecta el avatar recodificado y no un logo de fondo claro', async () => {
    // Reconstruye el avatar desde la referencia de 224 px y lo recodifica como el CDN.
    const avatar = await sharp(Buffer.from(GENERIC_AVATAR_HASHES[0], 'hex'), { raw: { width: 8, height: 8, channels: 1 } })
      .resize(150, 150).jpeg({ quality: 70 }).toBuffer()
    const lightLogo = await png('<rect width="320" height="320" fill="#d2d0c1"/><rect x="60" y="140" width="200" height="40" fill="#3b481d"/>')

    expect(isGenericAvatarHash(await imageHash(avatar))).toBe(true)
    expect(isGenericAvatarHash(await imageHash(lightLogo))).toBe(false)
  })

  it('reconoce el avatar por defecto por el nombre de archivo del CDN, sin descargarlo', async () => {
    const options = deps(Buffer.alloc(0))
    const outcome = await fetchPlaceLogo({ ...profile, profilePicUrl: 'https://scontent.cdninstagram.com/v/t51.2885-19/573323465_1219825463302212_7278921664109726296_n.png?x=1' }, 'place-1', options)
    const old = await fetchPlaceLogo({ ...profile, profilePicUrl: 'https://scontent.cdninstagram.com/v/t51.2885-19/44884218_345707102882519_2446069589734326272_n.jpg?x=1' }, 'place-1', options)

    expect(outcome.review).toEqual({ status: 'missing', reason: 'generic_avatar', kind: null })
    expect(old.review.reason).toBe('generic_avatar')
    expect(options.fetcher).not.toHaveBeenCalled()
  })
})

describe('fetchPlaceLogo', () => {
  it('procesa a 256×256 WebP y sube con la clave logos/<placeId>-<hash>.webp', async () => {
    const options = deps(await png('<rect width="400" height="400" fill="#ffffff"/><circle cx="200" cy="200" r="80" fill="#c0392b"/>', 400))

    const outcome = await fetchPlaceLogo(profile, 'ChIJ_abc-123', options)

    expect(outcome.logo).toEqual({
      key: expect.stringMatching(/^logos\/ChIJ_abc-123-[0-9a-f]{8}\.webp$/),
      kind: 'logo', bgColor: '#ffffff', color: '#c0392b', source: 'instagram', fetchedAt: '2026-10-16T12:00:00.000Z',
    })
    const [key, body] = vi.mocked(options.storage!.put).mock.calls[0]
    expect(key).toBe(outcome.logo?.key)
    expect(await sharp(body).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 })
    expect(outcome.classification).toEqual({ model: 'anthropic/claude-haiku-5.5', usage: { inputTokens: 900, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: 8, gatewayCostUsd: null } })
  })

  it('misma imagen, misma clave: reprocesar no duplica', async () => {
    const image = await png('<rect width="320" height="320" fill="#123456"/>')
    const first = await fetchPlaceLogo(profile, 'place-1', deps(image))
    const second = await fetchPlaceLogo(profile, 'place-1', deps(image))
    expect(first.logo?.key).toBe(second.logo?.key)
  })

  it('sin Instagram, sin foto, foto chica o algo que no es imagen: no hay logo ni clasificación', async () => {
    const classify = vi.fn()
    const small = await png('<rect width="100" height="100" fill="#123456"/>', 100)

    expect((await fetchPlaceLogo(null, 'p', deps(small, { classify }))).review.reason).toBe('no_instagram')
    expect((await fetchPlaceLogo({ ...profile, profilePicUrl: undefined }, 'p', deps(small, { classify }))).review.reason).toBe('no_picture')
    expect((await fetchPlaceLogo(profile, 'p', deps(small, { classify }))).review).toEqual({ status: 'missing', reason: 'too_small', kind: null })
    expect((await fetchPlaceLogo(profile, 'p', deps(Buffer.from('<html>no</html>'), { classify }))).review.reason).toBe('not_image')
    expect((await fetchPlaceLogo(profile, 'p', deps(new Response('', { status: 403 }), { classify }))).review).toEqual({ status: 'failed', reason: 'download_failed', kind: null, detail: '403' })
    expect(classify).not.toHaveBeenCalled()
  })

  it('el motivo de una descarga fallida lleva el código HTTP, timeout o red, y lo que no es imagen su content-type', async () => {
    const reviewFor = async (fetcher: LogoDeps['fetcher']) => (await fetchPlaceLogo(profile, 'p', { ...deps(Buffer.alloc(0)), fetcher })).review
    const failing = (error: unknown) => vi.fn(async () => { throw error }) as never

    expect(await reviewFor(vi.fn(async () => new Response('', { status: 404 })) as never)).toMatchObject({ reason: 'download_failed', detail: '404' })
    expect(await reviewFor(failing(new DOMException('timeout', 'TimeoutError')))).toMatchObject({ reason: 'download_failed', detail: 'timeout' })
    expect(await reviewFor(failing(new TypeError('fetch failed')))).toMatchObject({ reason: 'download_failed', detail: 'red' })
    expect(await reviewFor(vi.fn(async () => new Response('', { status: 200 })) as never)).toMatchObject({ reason: 'download_failed', detail: 'vacía' })
    expect(await reviewFor(vi.fn(async () => new Response('<html>login</html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })) as never))
      .toEqual({ status: 'missing', reason: 'not_image', kind: null, detail: 'text/html' })
  })

  it('sin bucket configurado no descarga ni clasifica', async () => {
    const options = deps(Buffer.alloc(0), { storage: { configured: false, put: vi.fn() } })
    const outcome = await fetchPlaceLogo(profile, 'p', options)
    expect(outcome.review).toEqual({ status: 'failed', reason: 'storage_not_configured', kind: null })
    expect(options.fetcher).not.toHaveBeenCalled()
  })

  it('si la clasificación falla, sube igual con kind null y lo anota', async () => {
    const options = deps(await png('<rect width="320" height="320" fill="#123456"/>'), { classify: vi.fn(async () => { throw new Error('gateway') }) })

    const outcome = await fetchPlaceLogo(profile, 'p', options)

    expect(outcome.logo).toMatchObject({ kind: null, bgColor: '#123456' })
    expect(outcome.review).toEqual({ status: 'failed', reason: 'classification_failed', kind: null })
    expect(outcome.classification).toBeNull()
  })

  it('una foto de una persona no se sube: queda sin logo, con la clasificación y su costo', async () => {
    const options = deps(await png('<rect width="320" height="320" fill="#123456"/>'), { classify: vi.fn(async () => ({ kind: 'person' as const, inputTokens: 900, outputTokens: 8, gatewayCostUsd: null })) })

    const outcome = await fetchPlaceLogo(profile, 'p', options)

    expect(outcome.logo).toBeNull()
    expect(outcome.review).toEqual({ status: 'missing', reason: 'person_photo', kind: 'person' })
    expect(outcome.classification).toMatchObject({ model: 'anthropic/claude-haiku-5.5' })
    expect(options.storage!.put).not.toHaveBeenCalled()
  })

  it('reusa la clasificación hecha al elegir el perfil sin volver a llamar al modelo', async () => {
    const classify = vi.fn()
    const known = { kind: 'person' as const, classification: { model: 'anthropic/claude-haiku-5.5', usage: { inputTokens: 900, cachedInputTokens: null, outputTokens: 8, gatewayCostUsd: null } } }
    const outcome = await fetchPlaceLogo(profile, 'p', deps(await png('<rect width="320" height="320" fill="#123456"/>'), { classify, known }))
    expect(classify).not.toHaveBeenCalled()
    expect(outcome.review).toEqual({ status: 'missing', reason: 'person_photo', kind: 'person' })
    // El costo ya se contó al clasificarla.
    expect(outcome.classification).toBeNull()
  })

  it('las demás clasificaciones se suben como siempre', async () => {
    for (const kind of ['local', 'food', 'other'] as const) {
      const options = deps(await png('<rect width="320" height="320" fill="#123456"/>'), { classify: vi.fn(async () => ({ kind })) })
      const outcome = await fetchPlaceLogo(profile, 'p', options)
      expect(outcome.logo).toMatchObject({ kind })
      expect(options.storage!.put).toHaveBeenCalledTimes(1)
    }
  })
})

describe('profilePictureStatus (desempate de Instagram)', () => {
  const genericUrl = 'https://scontent.cdninstagram.com/v/t51.2885-19/573323465_1219825463302212_7278921664109726296_n.png?x=1'
  const serve = (image: Buffer | Response) => vi.fn(async () => image instanceof Response ? image : new Response(new Uint8Array(image), { status: 200 })) as never

  it('reconoce el avatar genérico por el nombre de archivo, sin descargarlo, o por el hash', async () => {
    const fetcher = serve(Buffer.alloc(0))
    expect(await profilePictureStatus(genericUrl, fetcher)).toBe('generic')
    expect(fetcher).not.toHaveBeenCalled()

    const avatar = await sharp(Buffer.from(GENERIC_AVATAR_HASHES[0], 'hex'), { raw: { width: 8, height: 8, channels: 1 } })
      .resize(150, 150).jpeg({ quality: 70 }).toBuffer()
    expect(await profilePictureStatus('https://cdn.example/otro-nombre.jpg', serve(avatar))).toBe('generic')
  })

  it('una foto real es real; sin foto, sin descarga o si no es imagen, unknown', async () => {
    const logo = await png('<rect width="320" height="320" fill="#1d3b48"/><circle cx="160" cy="160" r="90" fill="#f2c14e"/>')
    expect(await profilePictureStatus('https://cdn.example/logo.jpg', serve(logo))).toBe('real')
    expect(await profilePictureStatus(undefined, serve(logo))).toBe('unknown')
    expect(await profilePictureStatus('https://cdn.example/logo.jpg', serve(new Response('no', { status: 404 })))).toBe('unknown')
    expect(await profilePictureStatus('https://cdn.example/logo.jpg', serve(Buffer.from('no es una imagen')))).toBe('unknown')
  })
})

describe('classifyProfilePicture', () => {
  it('clasifica la foto con su uso, y devuelve null sin foto, con el avatar genérico, sin descarga o si el modelo falla', async () => {
    const image = await png('<rect width="320" height="320" fill="#a0522d"/>')
    const classify = vi.fn(async () => ({ kind: 'person' as const, inputTokens: 600, outputTokens: 5, gatewayCostUsd: 0.0007 }))
    const options = { ...deps(image), classify }
    expect(await classifyProfilePicture('https://cdn.example/p.jpg', options)).toEqual({
      kind: 'person',
      classification: { model: 'anthropic/claude-haiku-5.5', usage: { inputTokens: 600, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: 5, gatewayCostUsd: 0.0007 } },
    })
    classify.mockClear()
    expect(await classifyProfilePicture(undefined, options)).toBeNull()
    expect(await classifyProfilePicture('https://scontent.cdninstagram.com/v/t51.2885-19/573323465_1219825463302212_7278921664109726296_n.png?x=1', options)).toBeNull()
    expect(await classifyProfilePicture('https://cdn.example/p.jpg', { ...deps(new Response('', { status: 403 })), classify })).toBeNull()
    expect(classify).not.toHaveBeenCalled()
    expect(await classifyProfilePicture('https://cdn.example/p.jpg', { ...options, classify: vi.fn(async () => { throw new Error('gateway') }) })).toBeNull()
  })
})
