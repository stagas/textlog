import { afterEach, describe, expect, test } from 'bun:test'
import { createImageKey, deleteImage, getImageUrl, imageDimensions, localImageFile, uploadImage,
  validateImageData } from './image-storage'

const previousEnvironment = Bun.env.NODE_ENV
const previousPublicUrl = Bun.env.R2_PUBLIC_URL

afterEach(() => {
  Bun.env.NODE_ENV = previousEnvironment
  Bun.env.R2_PUBLIC_URL = previousPublicUrl
})

describe('image storage', () => {
  test('derives UUID object keys from validated image types', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1,
    ])
    const contentType = validateImageData(png, 'image/png')
    expect(createImageKey(contentType)).toMatch(/^images\/[0-9a-f-]{36}\.png$/)
    expect(imageDimensions(png, contentType)).toEqual({ width: 1, height: 1 })
    expect(() => validateImageData(png, 'image/jpeg')).toThrow('does not match')
  })

  test('reads allowed image dimensions without native decoder support', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02])
    expect(imageDimensions(gif, validateImageData(gif, 'image/gif'))).toEqual({ width: 800, height: 600 })
    expect(() => imageDimensions(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0]),
      'image/gif')).toThrow('Invalid or oversized')
  })

  test('writes, serves, and deletes the same object key locally', async () => {
    Bun.env.NODE_ENV = 'test'
    const key = `images/${crypto.randomUUID()}.gif`
    const data = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0])
    try {
      await uploadImage(key, data, 'image/gif')
      expect(getImageUrl(key)).toBe(`/uploads/${key}`)
      expect(await (await localImageFile(key))?.bytes()).toEqual(data)
    }
    finally {
      await deleteImage(key)
    }
    expect(await localImageFile(key)).toBeNull()
  })

  test('rejects traversal and unsupported extensions', () => {
    Bun.env.NODE_ENV = 'test'
    expect(() => getImageUrl('../secrets.png')).toThrow('Invalid image object key')
    expect(() => getImageUrl('images/file.svg')).toThrow('Invalid image object key')
  })

  test('uses the configured public URL in production', () => {
    Bun.env.NODE_ENV = 'production'
    Bun.env.R2_PUBLIC_URL = 'https://img.example.com/'
    expect(getImageUrl('images/preview.webp')).toBe('https://img.example.com/images/preview.webp')
  })
})
