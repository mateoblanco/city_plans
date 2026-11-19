import type { Guide } from '../../types'

/** BORRADOR de prueba (draft): sólo para ver el diseño de la página del barrio con varios grupos. No se publica. */
export const CORDON_SWEETS: Guide = {
  draft: true,
  slug: 'para-darse-un-gusto',
  city: 'montevideo',
  neighborhood: 'CORDON',
  group: 'desserts',
  title: 'Para darse un gusto',
  seoTitle: 'Helados y dulces en Cordón · Salimos',
  seoDescription: 'Heladería artesanal y dulces de vitrina en Cordón, para la merienda o el postre.',
  intro: ['Borrador: helados y dulces del barrio.'],
  updatedAt: '2026-11-19',
  places: [
    {
      // Don Antonio Helados
      id: '82937098-2bc1-4ba0-a2ae-c298859e7b12',
      text: 'Heladería artesanal con maestro heladero, sabores clásicos y otros más originales, con toppings y salsas.',
    },
    {
      // Ventanin
      id: '64ab0319-ac45-4f61-9311-64a4cdc64b46',
      text: 'Antojería dulce y vegana por ventanita a la calle. La carrot cake es una de sus estrellas.',
    },
    {
      // Uno Catorce Café
      id: 'e480f791-b974-49a3-b7f5-c81583be0da1',
      text: 'Cafetería chiquita con ventanita y mesas en la vereda. Probá la torta armenia shamalí con almíbar de hibisco.',
    },
  ],
}
