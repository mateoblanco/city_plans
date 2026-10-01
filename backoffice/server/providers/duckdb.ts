import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api'
import type { JsonValue } from '../../src/types/places.ts'

let instancePromise: Promise<DuckDBInstance> | undefined
let extensionsPromise: Promise<void> | undefined

async function getInstance(): Promise<DuckDBInstance> {
  instancePromise ??= DuckDBInstance.create(':memory:', {
    threads: '2',
    memory_limit: '512MB',
  })
  return instancePromise
}

export async function createDuckDBConnection(): Promise<DuckDBConnection> {
  extensionsPromise ??= (async () => {
    const connection = await DuckDBConnection.create(await getInstance())
    try {
      await connection.run(
        'INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; INSTALL iceberg; LOAD iceberg;',
      )
    } finally {
      connection.closeSync()
    }
  })().catch((error) => {
      extensionsPromise = undefined
      throw error
    })
  await extensionsPromise
  return DuckDBConnection.create(await getInstance())
}

export async function withDuckDB<T>(
  callback: (connection: DuckDBConnection) => Promise<T>,
): Promise<T> {
  const connection = await createDuckDBConnection()
  try {
    return await callback(connection)
  } finally {
    connection.closeSync()
  }
}

export async function queryJson(
  connection: DuckDBConnection,
  sql: string,
  values: (string | number)[] = [],
): Promise<Record<string, JsonValue>[]> {
  const reader = await connection.runAndReadAll(sql, values)
  return (await reader.getRowObjectsJson()) as Record<string, JsonValue>[]
}

export function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function validateQualifiedIdentifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*){1,2}$/.test(value)) {
    throw new Error('El nombre de tabla configurado no es válido.')
  }
  return value
}
