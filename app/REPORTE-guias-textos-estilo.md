# Guías: ajustes al estilo de los textos generados

Nada está commiteado. No toqué `search-href.ts`, `labels.ts` ni `PlaceCard.module.scss`. No hay migraciones.

## 1. Título: "Gancho: descripción"

- **Prompt:** pide la fórmula y remite a los ejemplos de la guía de estilo.
- **Schema:** exige un solo ":" con texto de los dos lados (`TITLE_FORMULA`), hasta 80 caracteres. Sin la fórmula, 422 y no se carga nada.
- **Ejemplos** en `config/guide-style.md`:
  - Primera cita sin ceremonia: bares y restós para charlar tranquilos
  - Cafés donde nadie te apura: para ir con la compu y quedarse la tarde
  - Juntada sin vueltas: lugares con mesa larga para ir en grupo
  - Domingo de merienda: cafés y panaderías para la tarde

## 2. Textos de cada lugar: sin repetir el tema ni arranques

- **El prompt** dice que el tema ya está en el título y no se repite (nada de "para una primera cita"). Además lleva **los textos que ya tiene la guía**, con el pedido de no repetir sus frases, palabras de arranque ni giros.
- **"Generar los vacíos"** va de a uno y en orden: cada lugar recibe los textos escritos a mano y los recién generados. Es más lento que antes, que iba de a 3 en paralelo: con 10 lugares, alrededor de un minuto.
- **Chequeos en código** (`server/guides/style-checks.ts`). El texto se rechaza (422, sin cargar) si:
  - usa una **muletilla prohibida**;
  - repite **el tema**: dos palabras seguidas con contenido del gancho del título (lo de antes de ":") o de la idea;
  - **arranca igual** que otro texto de la guía (las mismas 3 primeras palabras).
- **Muletillas prohibidas:** sección nueva de `config/guide-style.md`, con 15 frases para que ajustes: "sin formalidades", "sin ceremonia", "para compartir", "ideal para", "perfecto para", "si buscás", "no puede faltar", "la frutilla de la torta", "buena onda", "ambiente cálido", "excelente opción", "te va a encantar", "sin dudas", "propuesta gastronómica" y "experiencia única".
  - El código la lee de ahí en cada generación: se ajusta editando el archivo.
  - Vale para los textos de los lugares y la intro, no para los títulos.

## 3. Máximo 2 platos

- **Prompt:** "Como máximo 2 platos, los más distintivos. Nunca enumeres la carta."
- **Chequeo:** cuenta los `platos` de los datos del lugar que aparecen en el texto. Más de 2 → 422.
  - Las categorías ("Tapas y platitos", "Postres") no cuentan.
  - El singular y el plural son el mismo plato ("chivito", "chivitos").
  - Un plato dentro de otro nombrado cuenta una vez ("pollo" en "shawarma de pollo").

## 4. Precio integrado

- **Prompt:** el precio sólo si aporta y dentro de una frase ("un bodegón económico con…"), nunca suelto.
- **Chequeo:** rechaza una frase que sea sólo el precio ("Es caro.", "Precio medio.").
- **"Accesible":** la prueba mostró al modelo escribiendo "es accesible" en vez de la palabra fija. Ahora "accesible" cuenta como palabra de precio: sólo pasa si está en los datos, y nunca está.

## 5. Introducción

- **Schema:** pide 2 o 3 frases, una por ítem; menos o más, 422.
- **Prompt:** sólo el plan, sin nombrar lugares ni enumerar barrios.
- **Chequeo:** rechaza nombres de lugares de la guía, 2 barrios o más, y las muletillas. Un barrio solo (el de la guía) se tolera.

## 6. Página de la guía (app)

Revisado en pantalla con la vista previa de tu guía "primera-cita" y el árbol de accesibilidad.

- **El número no se leía dos veces.** El "1" grande es `aria-hidden` y el pin del mapa lo dice una sola vez ("1. Birra Brava").
  - El problema era el contrario: Safari/VoiceOver le saca la semántica a una `<ol>` con `list-style: none`, y la posición no se anunciaba nunca.
  - Con `role="list"`, el lector anuncia la posición una sola vez ("1 de 10").
- **Separador:** ahora es "Abre pronto · 18:00".
  - Va con el mismo espacio que "Cordón · Cervecería" de la línea de arriba.
  - El "·" es decorativo: el lector lee "Abre pronto 18:00".
  - Es una opción de `PlaceStatus` (`separator`) que sólo usa la guía. La ficha del lugar no cambió; si la querés igual ahí, es pasarle la opción.

## Errores en el editor

Los mensajes ahora separan dos casos:
- **Datos:** "El texto generado menciona un monto, que no se permite o no está en los datos."
- **Estilo:** "El texto generado no sigue la guía de estilo: más de 2 platos (pizza, faina, empanadas)."

## Prueba real con "primera-cita"

Con Opus, sin escribir en la base (US$ 0,35 la pasada completa y US$ 0,07 la repetición de 3 lugares).

- **Título:** Primera cita: bares con patio, tapas y tragos para charlar tranquilos
- **Intro (3 frases):** Para una primera cita conviene un lugar donde se pueda hablar sin gritar y donde la mesa no se vacíe enseguida. Estos bares tienen en común las tapas y platitos al centro, tragos de autor o cerveza tirada, y en muchos casos patio o lugar al aire libre. Sirven para arrancar con algo para tomar y, si la charla fluye, quedarse a cenar sin cambiar de lugar.
- **Textos de los lugares:** ninguno repite el tema y cada uno arranca distinto. El precio aparece integrado ("este restaurante caro de Pocitos", "una carta de precio medio"). Por ejemplo:
  - **Duna:** Del horno a leña salen pizzas y platitos, y la casa se conoce por las bitterballen de carne braseada y la fainá con muzzarella. Suma patio, música en vivo, cerveza artesanal tirada y tragos de autor.
  - **Bisiesto:** Mediterráneo de Punta Carretas con patio, cocina a la vista y un clima descontracturado. El shawarma de pollo al carbón y el cheesecake con curd de limón van con vino o tragos de estación, y hay opciones vegetarianas.
- **En la primera pasada, el chequeo de platos dejó 2 lugares sin texto (Marlon y Dilema) y rechazó un intento de Bisiesto.** Los tres fueron falsos positivos: contaba categorías y el singular y el plural por separado. Lo corregí (ver 3), y al repetir esos 3 salieron todos al primer intento, con 2 platos cada uno.
- **Ojo:** "Birra Brava … es accesible" fue antes del arreglo de "accesible"; ahora ese texto se rechazaría.

## Tests

- **Backoffice: 93 archivos y 1156 tests OK.** `tsc -b` y `oxlint` limpios.
  - **`style-checks.test.ts`, nuevo:**
    - las muletillas se leen de la guía de estilo y van por palabra completa;
    - el tema repetido desde el gancho (lo de después de ":" no cuenta);
    - el mismo arranque;
    - más de 2 platos, con el caso singular/plural y un plato dentro de otro;
    - el precio suelto;
    - la intro con nombres de lugares o una lista de barrios.
  - **`generate.test.ts`:**
    - título con y sin la fórmula;
    - intro con 1, 2 frases o con un lugar nombrado;
    - texto de un lugar con el tema, una muletilla o la carta enumerada;
    - el prompt lleva los textos que ya tiene la guía;
    - "generar los vacíos" va en orden y cada uno ve los anteriores;
    - "accesible" rechazado.
- **App: 109 archivos y 1750 tests OK.** `tsc --noEmit` y `eslint` limpios.
