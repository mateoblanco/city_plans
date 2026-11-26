import type { Config, OverridedMixpanel } from "mixpanel-browser";
import type { Client, Mode } from "./track";

/** Parámetros de campaña y de clics de publicidad que Mixpanel lee de la URL (CAMPAIGN_KEYWORDS y CLICK_IDS). */
const URL_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id", "utm_source_platform", "utm_campaign_id",
  "utm_creative_format", "utm_marketing_tactic",
  "dclid", "fbclid", "gclid", "ko_click_id", "li_fat_id", "msclkid", "sccid", "ttclid", "twclid", "wbraid",
];

/**
 * Propiedades que Mixpanel agrega solo y no mandamos: la URL completa y la query del page view (`current_url_search`:
 * `q`, el texto, y un `near=lat,lng` de un link viejo), los referrers y los parámetros de la URL. Del page view quedan
 * la ruta (`current_url_path`), el dominio y el título.
 */
export const BLOCKED_PROPERTIES = [
  "$current_url",
  "current_url_search",
  "$referrer",
  "$referring_domain",
  "$initial_referrer",
  "$initial_referring_domain",
  "$search_engine",
  "mp_keyword",
  ...URL_PARAMS,
];

/**
 * Configuración de Mixpanel. Sin cookies ni localStorage (`disable_persistence`: el identificador vive en memoria hasta
 * la recarga; `batch_requests: false` porque la cola de lotes usa localStorage), sin geolocalización por IP (`ip: false`),
 * sin captura automática, sin page views propios ni grabación de sesiones (la entrada `loader-module-core` no la trae).
 */
// `track_marketing` (UTM en cada evento) existe en la librería pero no en sus tipos.
export function mixpanelConfig(mode: Exclude<Mode, "off">): Partial<Config> & { track_marketing: boolean } {
  return {
    ip: false,
    disable_persistence: true,
    batch_requests: false,
    autocapture: false,
    // Los page views los manda NavigationTracker con track_pageview() (el evento nativo), no la librería sola.
    track_pageview: false,
    track_marketing: false,
    save_referrer: false,
    stop_utm_persistence: true,
    property_blacklist: BLOCKED_PROPERTIES,
    // Debug (desarrollo): el payload final que se mandaría, en la consola, y no se manda.
    hooks:
      mode === "debug"
        ? {
            before_send_events: (payload) => {
              console.info("[mixpanel]", payload.event, payload.properties);
              return null;
            },
          }
        : {},
  };
}

/** Baja la librería (su propio chunk) e inicializa. Si falla, no hay analítica y no pasa nada más. */
export async function loadMixpanel(mode: Exclude<Mode, "off">, token: string): Promise<Client | null> {
  try {
    // Sin el grabador de sesiones (la entrada por defecto lo trae y pesa ~10 veces más). Su .d.ts no reexporta el default.
    const loaded = (await import("mixpanel-browser/src/loaders/loader-module-core")) as unknown as { default: OverridedMixpanel };
    const mixpanel = loaded.default;
    mixpanel.init(token, mixpanelConfig(mode));
    return {
      track: (event, props) => mixpanel.track(event, props),
      pageView: (props) => mixpanel.track_pageview(props),
    };
  } catch {
    return null;
  }
}
