// Sin imports: lo usan la ficha en el servidor y el puntaje de Google en el cliente (PlaceRating).

/** "1.230": con punto de miles también en 4 cifras (el formato de es-UY lo omite en algunos motores). */
export function countText(count: number): string {
  return String(Math.round(count)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** El puntaje de Google en la ficha: "4,4", "1.230" reseñas y el link a las reseñas en Google Maps. */
export type RatingInfo = { value: string; count: string | null; href: string | null };

/** null sin puntaje; sin link de reseñas de Google, el link general del lugar (fallbackHref). */
export function ratingInfo(
  google: { rating: number | null; ratingCount: number | null; reviewsHref: string | null } | null,
  fallbackHref: string | null,
): RatingInfo | null {
  if (!google?.rating) return null;
  return {
    value: ratingText(google.rating),
    count: google.ratingCount ? countText(google.ratingCount) : null,
    href: google.reviewsHref ?? fallbackHref,
  };
}

/** "4,6": un decimal, con coma. */
export function ratingText(rating: number): string {
  return rating.toLocaleString("es-UY", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
