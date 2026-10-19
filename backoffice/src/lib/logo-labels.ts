import type { LogoIssue, LogoKind } from '@/types/places'

// Etiquetas del paso del logo: las usan la miniatura (PlaceLogo) y el resumen del lote.
export const KIND_LABELS: Record<LogoKind, string> = {
  logo: 'Logo',
  local: 'Local',
  food: 'Comida',
  person: 'Persona',
  other: 'Otro',
}

export const ISSUE_LABELS: Record<LogoIssue, string> = {
  no_instagram: 'sin Instagram validado',
  no_picture: 'el perfil no tiene foto',
  download_failed: 'no se pudo descargar la foto',
  not_image: 'la foto no es una imagen',
  too_small: 'la foto mide menos de 150 px',
  generic_avatar: 'avatar genérico de Instagram',
  classification_failed: 'no se pudo clasificar',
  processing_failed: 'no se pudo procesar la imagen',
  storage_not_configured: 'falta configurar R2',
  upload_failed: 'no se pudo subir a R2',
  person_photo: 'la foto es de una persona',
}
