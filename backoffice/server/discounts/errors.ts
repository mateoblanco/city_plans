/** La fuente no tiene la estructura esperada (o no trajo lugares): falla en vez de devolver vacío. */
export class DiscountSourceError extends Error {
  readonly providerId: string
  readonly url?: string

  constructor(providerId: string, message: string, url?: string) {
    super(message)
    this.name = 'DiscountSourceError'
    this.providerId = providerId
    this.url = url
  }
}
