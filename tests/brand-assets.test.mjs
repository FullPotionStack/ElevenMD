import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { inflateSync } from 'node:zlib'

const root = path.resolve(import.meta.dirname, '..')
test('checked-in branding assets reproduce exactly and contain every Windows icon size', async () => {
  const { createBrandAssets, iconSizes } = await import('../scripts/generate-brand-assets.mjs')
  const generated = createBrandAssets()
  assert.equal(await readFile(path.join(root, 'public/elevenmd-mark.svg'), 'utf8'), generated.svg)
  assert.deepEqual(await readFile(path.join(root, 'public/elevenmd.ico')), generated.ico)
  assert.deepEqual(iconSizes, [16, 24, 32, 48, 64, 128, 256])
  assert.equal(generated.ico.readUInt16LE(4), iconSizes.length)
  assert.match(generated.svg, /M20 46V18M44 46V18/)
  assert.match(generated.svg, /M20 18L32 35L44 18/)
  assert.doesNotMatch(generated.svg, /circle|h34/)
  for (let i = 0; i < iconSizes.length; i++) {
    const size = iconSizes[i]
    const entry = 6 + i * 16
    assert.equal(generated.ico[entry] || 256, size)
    const offset = generated.ico.readUInt32LE(entry + 12)
    const length = generated.ico.readUInt32LE(entry + 8)
    const png = generated.ico.subarray(offset, offset + length)
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    assert.equal(png.readUInt32BE(16), size)
    assert.equal(png.readUInt32BE(20), size)
    let cursor = 8
    const data = []
    while (cursor < png.length) {
      const n = png.readUInt32BE(cursor)
      if (png.toString('ascii', cursor + 4, cursor + 8) === 'IDAT') data.push(png.subarray(cursor + 8, cursor + 8 + n))
      cursor += 12 + n
    }
    const pixels = inflateSync(Buffer.concat(data))
    assert.equal(pixels.length, size * (1 + size * 4))
    const pixel = (x, y) => [...pixels.subarray(y * (1 + size * 4) + 1 + x * 4, y * (1 + size * 4) + 5 + x * 4)]
    assert.equal(pixel(0, 0)[3], 0, `transparent corner at ${size}`)
    assert.ok(pixel(Math.floor(size * 20 / 64), Math.floor(size * 40 / 64))[0] > 200, `left pillar at ${size}`)
    assert.ok(pixel(Math.floor(size * 44 / 64), Math.floor(size * 40 / 64))[0] > 200, `right pillar at ${size}`)
    const middle = pixel(Math.round(size / 2), Math.round(size * 33 / 64))
    assert.ok(middle[0] > 180 && middle[1] < 180, `coral V at ${size}`)
  }
})
