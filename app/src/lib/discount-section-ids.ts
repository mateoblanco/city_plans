/** Id de un grupo por proveedor de descuento: `discount:<proveedor>`. Lo usan el servidor y el "Ver todos" del cliente. */
export type DiscountSectionId = `discount:${string}`

export const isDiscountSectionId = (id: string): id is DiscountSectionId => id.startsWith('discount:')

/** El proveedor de un grupo `discount:<proveedor>`. */
export const discountSectionProvider = (id: DiscountSectionId) => id.slice('discount:'.length)
