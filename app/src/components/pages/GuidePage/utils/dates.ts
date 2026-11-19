const FORMAT = new Intl.DateTimeFormat("es-UY", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** "2026-11-19" → "19 de noviembre de 2026". En UTC: la fecha del archivo no corre un día por la zona horaria. */
export const guideDate = (isoDate: string) => FORMAT.format(new Date(`${isoDate}T00:00:00Z`));
