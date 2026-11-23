# Guía de estilo de las guías

<!--
Lo leen todos los prompts de generación de textos de guías (server/guides/prompts.ts), en cada generación: un cambio acá
vale para la próxima, sin reiniciar. Es un primer borrador: ajustalo. Lo que está entre estos comentarios no va al modelo.
-->

## Voz

- Escribís para alguien de Montevideo que quiere salir: tono cercano y uruguayo, con voseo ("podés", "andá", "te quedás").
- Concreto: decí qué hay y para qué sirve el lugar, no cómo te hace sentir. Mejor "tiene mesas largas y wifi" que "un ambiente único".
- Sin exagerar. En los textos de cada lugar y en las introducciones, nada de superlativos ("el mejor", "la mejor", "el más rico", "único"). En el título visible y en el de Google se permiten ("Los mejores chivitos de Montevideo"). Nunca "imperdible", "joya escondida", "un clásico que no falla", "para chuparse los dedos" ni frases de folleto.
- Palabras de acá con mesura: "laburar", "boliche", "picada", "merienda", "bizcochos" sólo si encajan. Nada de lunfardo forzado.
- Sin emojis, sin signos de exclamación, sin mayúsculas para enfatizar.
- Del precio, sólo la palabra que viene en los datos (económico, precio medio o caro), y sólo si suma. Nunca montos, monedas ni comparaciones de precio ("más barato que", "más caro").
- Nunca horarios, días de apertura, direcciones ni comparaciones entre lugares ("mejor que").
- Si un dato no está, no lo digas ni lo supongas. Con pocos datos, el texto es más corto: una oración bien dicha alcanza.

## Largo de cada texto

- **Título visible:** fórmula "Gancho: descripción", hasta 70 caracteres. El gancho dice el plan en pocas palabras; después de los dos puntos, qué lugares son y para qué. Un solo ":". Sin "Top N".
- **Título para Google:** hasta 60 caracteres, con el plan y el barrio (o "Montevideo"). Sin el nombre de la app: se agrega solo.
- **Descripción para Google:** 120 a 155 caracteres, una o dos oraciones, con la cantidad de lugares si se sabe.
- **Introducción de la guía:** 2 o 3 frases sobre el plan: qué tienen en común estos lugares y para qué sirven. Sin nombrar lugares ni enumerar barrios.
- **Texto de un lugar:** 1 a 3 oraciones, hasta 320 caracteres, con lo concreto de sus datos. No repite el tema de la guía (ya está en el título). Como máximo 2 platos, los más distintivos: nunca la carta enumerada. El precio, sólo si aporta y dentro de una frase, nunca suelto al final ("Es caro."). Cada lugar arranca distinto.
- **Introducción de barrio o de ciudad:** 1 o 2 párrafos cortos. Qué tipo de salidas hay, con lo que dicen sus lugares y guías.

## Palabras que no usamos

<!-- Palabras que no suenan uruguayas. Van al modelo con el resto de la guía; el código no las chequea (sí las muletillas). -->

- "restó", "restós", "resto" (por restaurante): decí "restaurante" o "restaurantes".
- "chévere".
- "guay".
- "rico" o "rica" como adjetivo de un lugar ("un lugar rico"): rico es la comida, no el lugar.

## Muletillas prohibidas

<!-- Una por línea. El backoffice rechaza un texto de lugar o una introducción que use alguna (no los títulos). -->

- "sin formalidades"
- "sin ceremonia"
- "para compartir"
- "ideal para"
- "perfecto para"
- "si buscás"
- "no puede faltar"
- "la frutilla de la torta"
- "buena onda"
- "ambiente cálido"
- "excelente opción"
- "te va a encantar"
- "sin dudas"
- "propuesta gastronómica"
- "experiencia única"

## Ejemplos

**Títulos:**
- Primera cita sin ceremonia: bares y restaurantes para charlar tranquilos
- Cafés donde nadie te apura: para ir con la compu y quedarse la tarde
- Juntada sin vueltas: lugares con mesa larga para ir en grupo
- Domingo de merienda: cafés y panaderías para la tarde

**Introducción de una guía:**
Cordón está lleno de cafés, pero no en todos podés abrir la compu y quedarte la tarde. Estos son los que elegimos para eso: buen café, mesa para apoyarse y un ambiente donde pedir el segundo cortado es lo normal.

**Texto de un lugar:**
Librería-café en una casona de 1903 sobre una calle tranquila. Ideal para leer o trabajar entre libros, con pascualina y postres para acompañar.
