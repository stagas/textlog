import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { mkdir, unlink } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { isDevelopment } from './environment'
import { logError, logInfo } from './log'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const localUploadDirectory = resolve('storage/uploads')
const imageExtensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const

export type ImageContentType = keyof typeof imageExtensions

let client: S3Client | undefined

function r2Client() {
  client ||= new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
  return client
}

export function usesLocalImageStorage() {
  return isDevelopment() || Bun.env.NODE_ENV === 'test'
}

export function isImageKey(key: string) {
  return key.length <= 240
    && /^(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9._-]*\.(?:jpg|png|webp|gif)$/.test(key)
    && !key.split('/').some(part => part === '.' || part === '..')
}

function checkedImageKey(key: string) {
  if (!isImageKey(key)) throw new Error('Invalid image object key')
  return key
}

function localImagePath(key: string) {
  const checked = checkedImageKey(key)
  const path = resolve(localUploadDirectory, ...checked.split('/'))
  if (!path.startsWith(localUploadDirectory + sep)) throw new Error('Invalid image object key')
  return path
}

function configuredBucket() {
  const bucket = Bun.env.R2_BUCKET?.trim()
  if (!bucket) throw new Error('R2_BUCKET is not configured')
  return bucket
}

export async function uploadImage(key: string, data: Uint8Array, contentType: ImageContentType) {
  const checked = checkedImageKey(key)
  if (!imageExtensions[contentType]) throw new Error('Unsupported image content type')
  const startedAt = performance.now()
  const backend = usesLocalImageStorage() ? 'local' : 'r2'
  const bucket = backend === 'r2' ? configuredBucket() : undefined
  const context = `image storage upload backend=${backend}${bucket ? ` bucket=${bucket}` : ''} key=${checked} bytes=${data.byteLength} content_type=${contentType}`
  logInfo(`${context} status=started`)
  try {
    if (backend === 'local') {
      const path = localImagePath(checked)
      await mkdir(path.slice(0, path.lastIndexOf(sep)), { recursive: true, mode: 0o700 })
      await Bun.write(path, data)
    }
    else {
      await r2Client().send(new PutObjectCommand({
        Bucket: bucket!,
        Key: checked,
        Body: data,
        ContentType: contentType,
      }))
    }
    logInfo(`${context} status=succeeded duration_ms=${Math.round(performance.now() - startedAt)}`)
    return checked
  }
  catch (error) {
    logError(`${context} status=failed duration_ms=${Math.round(performance.now() - startedAt)}`, error)
    throw error
  }
}

export async function deleteImage(key: string) {
  const checked = checkedImageKey(key)
  const startedAt = performance.now()
  const backend = usesLocalImageStorage() ? 'local' : 'r2'
  const bucket = backend === 'r2' ? configuredBucket() : undefined
  const context = `image storage delete backend=${backend}${bucket ? ` bucket=${bucket}` : ''} key=${checked}`
  logInfo(`${context} status=started`)
  try {
    if (backend === 'local') {
      try {
        await unlink(localImagePath(checked))
      }
      catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
        logInfo(`${context} status=missing duration_ms=${Math.round(performance.now() - startedAt)}`)
        return
      }
    }
    else {
      await r2Client().send(new DeleteObjectCommand({ Bucket: bucket!, Key: checked }))
    }
    logInfo(`${context} status=succeeded duration_ms=${Math.round(performance.now() - startedAt)}`)
  }
  catch (error) {
    logError(`${context} status=failed duration_ms=${Math.round(performance.now() - startedAt)}`, error)
    throw error
  }
}

export function getImageUrl(key: string) {
  const checked = checkedImageKey(key)
  if (usesLocalImageStorage()) return `/uploads/${checked}`
  const publicUrl = Bun.env.R2_PUBLIC_URL?.trim().replace(/\/$/, '')
  if (!publicUrl) throw new Error('R2_PUBLIC_URL is not configured')
  return `${publicUrl}/${checked}`
}

export function createImageKey(contentType: ImageContentType, prefix = 'images') {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(prefix)) throw new Error('Invalid image object prefix')
  return `${prefix}/${crypto.randomUUID()}.${imageExtensions[contentType]}`
}

function matches(bytes: Uint8Array, expected: number[], offset = 0) {
  return expected.every((byte, index) => bytes[offset + index] === byte)
}

function detectedImageType(bytes: Uint8Array): ImageContentType | null {
  if (bytes.length >= 4 && matches(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (bytes.length >= 24 && matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    && matches(bytes, [0x49, 0x48, 0x44, 0x52], 12)) return 'image/png'
  if (bytes.length >= 16 && matches(bytes, [0x52, 0x49, 0x46, 0x46])
    && matches(bytes, [0x57, 0x45, 0x42, 0x50], 8)
    && (matches(bytes, [0x56, 0x50, 0x38, 0x20], 12)
      || matches(bytes, [0x56, 0x50, 0x38, 0x4c], 12)
      || matches(bytes, [0x56, 0x50, 0x38, 0x58], 12))) return 'image/webp'
  if (bytes.length >= 10 && (matches(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
    || matches(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) return 'image/gif'
  return null
}

export function validateImageData(data: Uint8Array, contentType: string) {
  if (data.byteLength > MAX_IMAGE_BYTES) throw new Error('Image exceeds the size limit')
  const declaredType = contentType.split(';', 1)[0].trim().toLowerCase()
  if (!(declaredType in imageExtensions)) throw new Error('Unsupported image content type')
  const detectedType = detectedImageType(data)
  if (detectedType !== declaredType) throw new Error('Image data does not match its content type')
  return detectedType as ImageContentType
}

function uint16Le(data: Uint8Array, offset: number) {
  return data[offset] | data[offset + 1] << 8
}

function uint16Be(data: Uint8Array, offset: number) {
  return data[offset] << 8 | data[offset + 1]
}

function uint24Le(data: Uint8Array, offset: number) {
  return data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16
}

function uint32Be(data: Uint8Array, offset: number) {
  return (data[offset] * 0x1000000 + (data[offset + 1] << 16 | data[offset + 2] << 8 | data[offset + 3])) >>> 0
}

export function imageDimensions(data: Uint8Array, contentType: ImageContentType) {
  let width = 0
  let height = 0
  if (contentType === 'image/png' && data.length >= 24) {
    width = uint32Be(data, 16)
    height = uint32Be(data, 20)
  }
  else if (contentType === 'image/gif' && data.length >= 10) {
    width = uint16Le(data, 6)
    height = uint16Le(data, 8)
  }
  else if (contentType === 'image/webp') {
    if (matches(data, [0x56, 0x50, 0x38, 0x58], 12) && data.length >= 30) {
      width = uint24Le(data, 24) + 1
      height = uint24Le(data, 27) + 1
    }
    else if (matches(data, [0x56, 0x50, 0x38, 0x4c], 12) && data.length >= 25 && data[20] === 0x2f) {
      width = 1 + data[21] + ((data[22] & 0x3f) << 8)
      height = 1 + (data[22] >> 6) + (data[23] << 2) + ((data[24] & 0x0f) << 10)
    }
    else if (matches(data, [0x56, 0x50, 0x38, 0x20], 12) && data.length >= 30
      && matches(data, [0x9d, 0x01, 0x2a], 23)) {
      width = uint16Le(data, 26) & 0x3fff
      height = uint16Le(data, 28) & 0x3fff
    }
  }
  else if (contentType === 'image/jpeg') {
    for (let offset = 2; offset + 8 < data.length;) {
      if (data[offset] !== 0xff) break
      while (data[offset] === 0xff) offset++
      const marker = data[offset++]
      if (marker === 0xd8 || marker === 0xd9) continue
      if (offset + 2 > data.length) break
      const length = uint16Be(data, offset)
      if (length < 2 || offset + length > data.length) break
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        height = uint16Be(data, offset + 3)
        width = uint16Be(data, offset + 5)
        break
      }
      offset += length
    }
  }
  if (!width || !height || width > 10000 || height > 10000 || width * height > 40_000_000) {
    throw new Error('Invalid or oversized image dimensions')
  }
  return { width, height }
}

export async function deleteImages(keys: string[]) {
  await Promise.all([...new Set(keys)].filter(isImageKey).map(deleteImage))
}

export async function deleteImagesAfterCommit(keys: string[]) {
  try {
    await deleteImages(keys)
  }
  catch (error) {
    logError('stored image cleanup failed', error)
  }
}

export async function localImageFile(key: string) {
  if (!usesLocalImageStorage()) return null
  const file = Bun.file(localImagePath(key))
  return await file.exists() ? file : null
}
