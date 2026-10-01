# City Plans Backoffice

## Objetivo

Backoffice local para buscar lugares de Montevideo mediante Google Places API (New) y comparar sus datos con Overture Maps y OpenStreetMap. Sólo consulta y muestra resultados; no persiste, edita ni exporta contenido.

## Arquitectura

- `src/`: Vite, React, TypeScript, Tailwind CSS y componentes shadcn/ui.
- `server/`: API local Hono sobre Node. Es la única capa autorizada a leer la clave de Google.
- `src/data/`: barrios permitidos y snapshot tipado de categorías Food and Drink.
- `PlacesProvider`: límite entre el dominio y cada fuente externa. Mantener Google encapsulado en su provider.
- `POST /api/places/search`: acepta el modo controlado de barrio/categoría o texto libre acotado a Montevideo, más un token opaco de paginación.
- Los detalles Google se consultan una sola vez por `placeId`; las otras fuentes hacen matching espacial y textual desde ese ancla.

## Comandos

- `npm run dev`: frontend y API local.
- `npm run build`: typecheck y build del frontend.
- `npm run lint`: análisis estático.
- `npm test`: suite Vitest.

## Reglas

- Nunca exponer `GOOGLE_PLACES_API_KEY` al cliente, usar variables `VITE_*` para ella ni incluirla en logs o respuestas.
- Validar el texto libre, limitarlo a 2–200 caracteres y agregar el contexto geográfico de Montevideo en el provider.
- Mantener todos los textos de interfaz en español y los identificadores de Google en inglés.
- La búsqueda solicita solamente los campos que la tabla necesita. Place Details usa `*` únicamente al presionar **Buscar**, con advertencia visible en la documentación por costo.
- No almacenar contenido de Google Places. La deduplicación del MVP es sólo en memoria por `placeId`.
- Conservar la atribución visible de Google Maps junto a sus resultados.
- Encapsular cada fuente en su provider. La tabla usa `PlaceSummary`; la exploración conserva el JSON externo dentro de un envelope común auditable.
- Cualquier cambio funcional debe cubrir estados inicial, carga, vacío, éxito, error inicial y error parcial.

## Fuera del MVP

Autenticación, base de datos, edición, mapas, exportación, búsquedas masivas, cuadrícula geográfica y catálogo multi-fuente persistente.
