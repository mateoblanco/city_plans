# Instrucciones del proyecto

Leé y seguí `AGENTS.md` antes de modificar este proyecto.

Reglas críticas: la clave de Google Places es exclusivamente del servidor (el mapa usa una clave de navegador aparte, restringida); la UI está en español; no se persiste contenido de Places salvo el borrador del pipeline en Neon (`POST /api/places`); todas las entradas se validan contra catálogos permitidos; la atribución de Google Maps debe permanecer visible; y los cambios deben conservar pruebas de paginación, deduplicación y errores parciales.
