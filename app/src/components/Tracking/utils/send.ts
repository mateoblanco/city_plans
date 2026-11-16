import type { EventPayload } from "./track";

const ENDPOINT = "/api/events";

/**
 * En segundo plano: sendBeacon (sobrevive al cambio de página y no bloquea); si no está o la cola está llena, fetch con
 * keepalive. Sin await, sin reintentos: si falla, se pierde. text/plain para que no haya preflight. Los navegadores
 * automatizados (Lighthouse, Puppeteer, Playwright, Selenium) no envían: su user agent puede ser el de un teléfono
 * común, pero marcan navigator.webdriver.
 */
export function sendEvent(payload: EventPayload, nav: Navigator = navigator, fetcher: typeof fetch = fetch) {
  try {
    if (nav.webdriver) return;
    const body = JSON.stringify(payload);
    if (nav.sendBeacon?.(ENDPOINT, new Blob([body], { type: "text/plain" }))) return;
    void fetcher(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => {});
  } catch {
    // Nunca afecta a la página.
  }
}
