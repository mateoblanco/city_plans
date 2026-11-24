/** Privacidad y Términos: ruta y fecha de "Última actualización" (YYYY-MM-DD), la del sitemap también. Al cambiar un texto, subir su fecha. */
export const LEGAL_PAGES = {
  privacy: { path: "/privacy", title: "Política de privacidad", updatedAt: "2026-11-24" },
  terms: { path: "/terms", title: "Términos y condiciones", updatedAt: "2026-11-24" },
} as const;

export type LegalPageKey = keyof typeof LEGAL_PAGES;

/** Mail de contacto del responsable (privacidad, derechos y términos). */
export const LEGAL_CONTACT_EMAIL = "mateoblanco3@gmail.com";
