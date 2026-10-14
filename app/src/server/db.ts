import 'server-only'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'

// Sólo lectura de la tabla places que llena el backoffice. El esquema y las migraciones viven allá.
let client: ReturnType<typeof drizzle> | null = null

export function getDb() {
  if (!client) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('Falta DATABASE_URL')
    client = drizzle({ client: neon(url) })
  }
  return client
}
