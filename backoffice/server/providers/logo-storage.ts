import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

export const LOGO_BUCKET = 'logos'

export type LogoStorageConfig = {
  endpoint?: string
  region?: string
  accessKeyId?: string
  secretAccessKey?: string
}

/** Variables R2_*: nunca AWS_*, para no mezclarlas con credenciales de AWS. */
export function logoStorageConfig(env: Record<string, string | undefined> = process.env): LogoStorageConfig {
  return {
    endpoint: env.R2_ENDPOINT?.trim(),
    region: env.R2_REGION?.trim(),
    accessKeyId: env.R2_ACCESS_KEY_ID?.trim(),
    secretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(),
  }
}

/** URL pública de una clave del bucket, o null sin clave o sin LOGO_BASE_URL. */
export function logoUrl(key: string | null | undefined, baseUrl = process.env.LOGO_BASE_URL): string | null {
  const base = baseUrl?.trim().replace(/\/+$/, '')
  return key && base ? `${base}/${key}` : null
}

export type LogoObject = { key: string; lastModified: Date }

export type LogoStore = {
  readonly configured: boolean
  put(key: string, body: Buffer): Promise<void>
}

/** Bucket de logos en Cloudflare R2, por la API compatible con S3. */
export class R2LogoStorage implements LogoStore {
  readonly configured: boolean
  private readonly client: S3Client | null

  constructor(config: LogoStorageConfig = logoStorageConfig()) {
    const { endpoint, region, accessKeyId, secretAccessKey } = config
    this.configured = Boolean(endpoint && region && accessKeyId && secretAccessKey)
    // Credenciales explícitas: el SDK no lee AWS_* del entorno.
    this.client = this.configured
      ? new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! } })
      : null
  }

  private s3(): S3Client {
    if (!this.client) throw new Error('Falta configurar R2_ENDPOINT, R2_REGION, R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY.')
    return this.client
  }

  // La clave lleva el hash de la imagen: el contenido de una clave no cambia nunca.
  async put(key: string, body: Buffer) {
    await this.s3().send(new PutObjectCommand({
      Bucket: LOGO_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }))
  }

  async list(prefix: string): Promise<LogoObject[]> {
    const objects: LogoObject[] = []
    let token: string | undefined
    do {
      const page = await this.s3().send(new ListObjectsV2Command({ Bucket: LOGO_BUCKET, Prefix: prefix, ContinuationToken: token }))
      objects.push(...(page.Contents ?? []).flatMap((object) =>
        object.Key && object.LastModified ? [{ key: object.Key, lastModified: object.LastModified }] : []))
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
    return objects
  }

  /** Borra en lotes de 1000 (el máximo de DeleteObjects). Devuelve cuántas borró. */
  async deleteMany(keys: string[]): Promise<number> {
    let deleted = 0
    for (let index = 0; index < keys.length; index += 1000) {
      const batch = keys.slice(index, index + 1000)
      const result = await this.s3().send(new DeleteObjectsCommand({
        Bucket: LOGO_BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }))
      if (result.Errors?.length) throw new Error(`R2 no pudo borrar ${result.Errors.length} claves: ${result.Errors.map((error) => error.Key).join(', ')}`)
      deleted += batch.length
    }
    return deleted
  }
}
