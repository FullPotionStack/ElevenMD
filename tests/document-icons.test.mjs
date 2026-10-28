import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdtemp, rm, mkdir, cp } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { testScratch } from './helpers/electron-harness.mjs'
import { inflateSync } from 'node:zlib'

const root = path.resolve(import.meta.dirname, '..')
const generator = path.join(root, 'scripts/generate-document-icons.mjs')

test('checked-in document assets reproduce without rewriting canonical files', async () => {
  const { createDocumentAssets } = await import('../scripts/generate-document-icons.mjs')
  for (const kind of ['markdown', 'text']) {
    const assets = createDocumentAssets(kind)
    assert.equal(await readFile(path.join(root, `public/elevenmd-${kind}.svg`), 'utf8'), assets.svg)
    assert.ok((await readFile(path.join(root, `public/elevenmd-${kind}.ico`))).equals(assets.ico), `${kind} ICO drift`)
  }
})

test('CLI writes assets in an isolated scratch repo and only explicitly requested preview PNGs without changing the app logo', async () => {
  const { createDocumentAssets, documentIconSizes } = await import('../scripts/generate-document-icons.mjs')
  const appIco = await readFile(path.join(root, 'public/elevenmd.ico'))
  const appSvg = await readFile(path.join(root, 'public/elevenmd-mark.svg'))
  const scratch = await mkdtemp(path.join(await testScratch(), 'elevenmd-document-icons-'))
  const previewDir = path.join(scratch, 'previews')
  const isolatedGenerator = path.join(scratch, 'scripts/generate-document-icons.mjs')
  try {
    // The CLI derives its output root from its own location. Never regenerate
    // canonical public assets in a test: parallel packaging reads them too.
    await mkdir(path.join(scratch, 'scripts'), { recursive: true })
    await mkdir(path.join(scratch, 'public'), { recursive: true })
    await cp(generator, isolatedGenerator)
    execFileSync(process.execPath, [isolatedGenerator, previewDir], { cwd: scratch, windowsHide: true })
    assert.deepEqual((await readdir(previewDir)).sort(), ['markdown', 'text'].flatMap(kind => documentIconSizes.map(size => `elevenmd-${kind}-${size}.png`)).sort())
    const icons = []
    for (const kind of ['markdown', 'text']) {
      const assets = createDocumentAssets(kind)
      const again = createDocumentAssets(kind)
      assert.equal(assets.svg, again.svg)
      assert.deepEqual(assets.ico, again.ico, 'repeat generation has identical bytes')
      assert.deepEqual(assets.previews, again.previews)
      assert.equal(await readFile(path.join(scratch, `public/elevenmd-${kind}.svg`), 'utf8'), assets.svg)
      assert.deepEqual(await readFile(path.join(scratch, `public/elevenmd-${kind}.ico`)), assets.ico)
      for (const [i, size] of documentIconSizes.entries()) assert.deepEqual(await readFile(path.join(previewDir, `elevenmd-${kind}-${size}.png`)), assets.previews[i])
      assert.notDeepEqual(assets.ico, appIco, 'document and application icons differ')
      icons.push(assets.ico)
    }
    assert.notDeepEqual(icons[0], icons[1], 'MD and TXT are visually distinct')
    assert.deepEqual(await readFile(path.join(root, 'public/elevenmd.ico')), appIco)
    assert.deepEqual(await readFile(path.join(root, 'public/elevenmd-mark.svg')), appSvg)
    const before = await readdir(scratch)
    execFileSync(process.execPath, [isolatedGenerator], { cwd: scratch, windowsHide: true })
    assert.deepEqual(await readdir(scratch), before, 'no implicit preview destination')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

function decode(png) {
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const size = png.readUInt32BE(16)
  assert.equal(png.readUInt32BE(20), size)
  assert.equal(png[24], 8)
  assert.equal(png[25], 6, 'RGBA, not an opaque indexed image')
  const data = []
  for (let p = 8; p < png.length;) {
    const n = png.readUInt32BE(p)
    if (png.toString('ascii', p + 4, p + 8) === 'IDAT') data.push(png.subarray(p + 8, p + 8 + n))
    p += n + 12
  }
  const pixels = inflateSync(Buffer.concat(data))
  assert.equal(pixels.length, size * (1 + size * 4))
  for (let y = 0; y < size; y++) assert.equal(pixels[y * (1 + size * 4)], 0)
  const pixel = (x, y) => [...pixels.subarray(y * (1 + size * 4) + 1 + x * 4, y * (1 + size * 4) + 5 + x * 4)]
  return { size, pixel, at: (x, y) => pixel(Math.floor(x * size / 64), Math.floor(y * size / 64)) }
}

test('unknown document kinds are rejected rather than silently becoming TXT', async () => {
  const { createDocumentAssets } = await import('../scripts/generate-document-icons.mjs')
  for (const kind of [undefined, null, '', 'md', 'Markdown', 'TXT', {}, 1]) {
    assert.throws(() => createDocumentAssets(kind), /Unknown document icon kind/)
  }
})

test('document artwork uses the approved folded-page geometry with antialiased transparent ICO frames', async () => {
  const { createDocumentAssets, documentIconSizes } = await import('../scripts/generate-document-icons.mjs')
  assert.deepEqual(documentIconSizes, [16, 24, 32, 48, 64, 128, 256])
  for (const kind of ['markdown', 'text']) {
    const assets = createDocumentAssets(kind)
    assert.equal(assets.ico.readUInt16LE(0), 0)
    assert.equal(assets.ico.readUInt16LE(2), 1)
    assert.equal(assets.ico.readUInt16LE(4), documentIconSizes.length)
    assert.equal(assets.previews.length, documentIconSizes.length)
    assert.match(assets.svg, /viewBox="0 0 64 64"/)
    assert.match(assets.svg, /M10 3L39 3L54 18L54 60L10 60Z/)
    assert.match(assets.svg, /M39 3L39 18L54 18Z/)
    assert.doesNotMatch(assets.svg, /<text|font-family|<image|data:/)
    let nextOffset = 6 + 16 * documentIconSizes.length
    for (const [i, size] of documentIconSizes.entries()) {
      const entry = 6 + 16 * i
      assert.equal(assets.ico[entry] || 256, size)
      assert.equal(assets.ico[entry + 1] || 256, size)
      assert.equal(assets.ico.readUInt16LE(entry + 4), 1)
      assert.equal(assets.ico.readUInt16LE(entry + 6), 32)
      const length = assets.ico.readUInt32LE(entry + 8)
      const offset = assets.ico.readUInt32LE(entry + 12)
      assert.equal(offset, nextOffset)
      nextOffset += length
      const png = assets.ico.subarray(offset, offset + length)
      assert.deepEqual(png, assets.previews[i])
      const { at, pixel, size: actualSize } = decode(png)
      assert.equal(actualSize, size)
      assert.deepEqual(pixel(0, 0), [0, 0, 0, 0])
      assert.equal(pixel(size - 1, size - 1)[3], 0)
      assert.equal(at(52, 5)[3], 0, `outside folded corner at ${size}`)
      assert.deepEqual(at(22, 12), [255, 247, 237, 255], `warm ivory page at ${size}`)
      assert.deepEqual(at(43, 14), [229, 220, 210, 255], `fold at ${size}`)
      assert.deepEqual(at(17, 46), kind === 'markdown' ? [239, 128, 98, 255] : [73, 66, 78, 255], `badge at ${size}`)
      assert.ok(Array.from({ length: size * size }, (_, p) => pixel(p % size, Math.floor(p / size))[3]).some(alpha => alpha > 0 && alpha < 255), `supersampled curved/diagonal edge at ${size}`)
      if (size >= 128) {
        assert.deepEqual(at(10, 22), [101, 93, 101, 255], 'charcoal paper outline')
        assert.deepEqual(at(18, 24), kind === 'markdown' ? [73, 66, 78, 255] : [155, 144, 145, 255], 'document text strokes')
        assert.deepEqual(at(kind === 'markdown' ? 26 : 29, 50), kind === 'markdown' ? [33, 31, 41, 255] : [255, 247, 237, 255], 'vector badge lettering')
        if (kind === 'markdown') assert.deepEqual(at(40, 50), [239, 128, 98, 255], 'D counter preserves the coral badge through the glyph')
      }
    }
    assert.equal(nextOffset, assets.ico.length, 'no trailing or missing ICO payload')
  }
})
