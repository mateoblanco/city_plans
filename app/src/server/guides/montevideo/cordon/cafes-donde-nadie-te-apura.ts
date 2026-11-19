import type { Guide } from '../../types'

/**
 * Cafés de Cordón para ir con la compu o quedarse un rato. Borrador armado con los datos de la base (descripción, tags,
 * precio): revisar en persona antes de publicar. Para sacar un lugar, borrá su entrada; para cambiar el orden, movela.
 */
export const CORDON_CAFES: Guide = {
  slug: 'cafes-donde-nadie-te-apura',
  featured: true,
  city: 'montevideo',
  neighborhood: 'CORDON',
  group: 'cafes',
  title: 'Cafés donde nadie te apura',
  seoTitle: 'Cafés para trabajar o quedarse un rato en Cordón · Salimos',
  seoDescription:
    'Nueve cafés de Cordón, Montevideo, para ir con la compu o quedarte charlando sin que te miren el reloj. Con horarios y mapa.',
  intro: [
    'Cordón está lleno de cafés, pero no en todos podés abrir la compu y quedarte la tarde. Estos son los que elegimos para eso: buen café, mesa para apoyarse y un ambiente donde pedir el segundo cortado es lo normal.',
    'Van en el orden en que los recomendamos. Mirá si está abierto antes de ir: los horarios cambian.',
  ],
  updatedAt: '2026-11-19',
  places: [
    {
      // Inocencio Café
      id: '563b7d16-9a81-456a-9cd6-e0843b2ef594',
      text: 'Tranquilo, con buen wifi y pensado para ir con la compu. El café es bueno y el sándwich caliente te salva el almuerzo sin moverte de la mesa.',
    },
    {
      // Sauco café
      id: 'c6338150-36f9-491b-af57-23d20e180902',
      text: 'Acogedor y sin apuro. Desayunos, tartas y sándwiches, y al mediodía un plato del día para seguir trabajando sin salir a buscar dónde comer.',
    },
    {
      // Escaramuza
      id: '3efdb1da-7778-46eb-ad6e-c614f9341ee4',
      text: 'Librería-café en una casona de 1903 sobre una calle tranquila. Ideal para leer o trabajar entre libros, con pascualina y postres para acompañar. Algunas tardes hay talleres o presentaciones.',
    },
    {
      // Culto Café
      id: 'd8bb3166-dbe8-48d3-ad29-6f1414ade21a',
      text: 'La Tostaduría de Culto, con tostador propio: acá el café es el tema. De día se trabaja bien; a veces arman cuppings o encuentros con DJ, así que conviene mirar la agenda.',
    },
    {
      // Cardenal Café
      id: 'dff6f33c-a5f6-44ef-bedf-df638e023121',
      text: 'Sobre 18 de Julio, con café que tuestan ellos y un mostrador rojo lleno de pastelería y sándwiches. Tiene brunch y opciones veganas.',
    },
    {
      // Necio
      id: '1f7b4f18-501d-4566-9abd-c1df362cc23f',
      text: 'Barra de métodos con café de distintos tostadores uruguayos, para probar algo distinto mientras laburás. El espresso tónic es la especialidad. Un poco más caro que el resto.',
    },
    {
      // República Rotisería
      id: 'fa0fa5a3-323f-4ca0-824d-3b73db297980',
      text: 'En un ex taller mecánico, con onda informal. Café de especialidad, chipá chato y el Olímpico República si la mañana se estira hasta el almuerzo.',
    },
    {
      // Croissantería LA FÁBRICA
      id: '8f185ed0-b7f4-407b-935c-eef630876123',
      text: 'Croissants dulces y salados recién hechos con café de especialidad. Buena para arrancar la mañana con la compu y algo del horno.',
    },
    {
      // Robusta Café
      id: '0592dec1-39e6-48d0-9b5d-ed9be996b9d5',
      text: 'Café de especialidad hecho por robots baristas, a precios accesibles. Desayunos, almuerzos y alfajores o cookies para la merienda.',
    },
  ],
}
