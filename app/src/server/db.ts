import 'server-only'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'

// Lectura de la tabla places que llena el backoffice; las únicas escrituras son los eventos de popularidad
// (server/events) y el refresco de coordenadas de Google (server/places/refresh). El esquema y las migraciones viven allá.
let client: ReturnType<typeof drizzle> | null = null
let raw: ReturnType<typeof neon> | null = null

function databaseUrl() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Falta DATABASE_URL')
  return url
}

/** SQL como texto con parámetros ($1…), para las consultas compartidas de /shared/events.ts. */
export function getSql() {
  raw ??= neon(databaseUrl())
  return raw
}

export function getDb() {
  if (!client) {
    client = drizzle({ client: neon(databaseUrl()) })
  }
  return client
}
