import type { PageRenderer } from './polite-fetch.ts'

const TIMEOUT_MS = 45_000

/**
 * Abre la página en Chromium headless (Playwright) y devuelve el HTML ya renderizado. `ready`: una expresión que el
 * navegador evalúa para saber que la página terminó de cargar los datos (sin ella, espera a que la red quede quieta); si
 * no se cumple en el tiempo, devuelve lo que haya y el lector decide (sin datos = error del proveedor). Un navegador por
 * página: es para fuentes de una sola página.
 */
export function playwrightRenderer(options: { ready?: string } = {}): PageRenderer {
  return async (url, { userAgent }) => {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({ headless: true })
    try {
      const context = await browser.newContext({ userAgent, locale: 'es-UY' })
      const page = await context.newPage()
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
      if (options.ready) await page.waitForFunction(options.ready, undefined, { timeout: TIMEOUT_MS }).catch(() => undefined)
      else await page.waitForLoadState('networkidle', { timeout: TIMEOUT_MS }).catch(() => undefined)
      return { status: response?.status() ?? 0, html: await page.content() }
    } finally {
      await browser.close()
    }
  }
}
