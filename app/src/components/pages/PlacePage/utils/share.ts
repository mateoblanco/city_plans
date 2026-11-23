import { SITE_URL } from "@/lib/site";

/**
 * Lo que se comparte de una ficha: la URL canónica absoluta (la misma que `alternates.canonical` de
 * app/place/[slug]/page.tsx, sobre SITE_URL), sin parámetros ni hash, para que todo link compartido apunte a la misma URL.
 */
export const placeShareUrl = (slug: string) => `${SITE_URL}/place/${slug}`;

/** WhatsApp con el texto listo para elegir el chat: "<título> <URL>". */
export const whatsappShareHref = (title: string, url: string) => `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`;

/** Lo que se usa de `navigator` (inyectable para los tests). */
export type ShareEnv = {
  share?: (data: ShareData) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

/** shared: se abrió el menú nativo y se compartió; cancelled: se cerró sin compartir (no es un error). */
export type ShareResult = "shared" | "cancelled" | "copied" | "failed";

/** Copia la URL al portapapeles. Sin portapapeles (p. ej. fuera de https) o sin permiso, "failed". */
export async function copyLink(url: string, env: ShareEnv): Promise<"copied" | "failed"> {
  try {
    if (!env.clipboard) return "failed";
    await env.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}

/**
 * El botón en pantallas táctiles: con Web Share API, el menú nativo con el título y la URL; sin ella, copia la URL. Si la
 * persona cierra el menú nativo (AbortError), "cancelled" y nada más. Cualquier otro error del menú nativo (p. ej. bloqueado
 * por el navegador) copia, para que el botón siempre haga algo.
 */
export async function shareOrCopy(data: { title: string; url: string }, env: ShareEnv): Promise<ShareResult> {
  if (typeof env.share === "function") {
    try {
      await env.share({ title: data.title, url: data.url });
      return "shared";
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === "AbortError") return "cancelled";
    }
  }
  return copyLink(data.url, env);
}

/** El aviso de debajo del botón (aria-live); null cuando no hay nada que decir (compartido o cancelado). */
export function shareMessage(result: ShareResult): string | null {
  if (result === "copied") return "Link copiado";
  if (result === "failed") return "No se pudo copiar el link";
  return null;
}
