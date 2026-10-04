import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Canonical geometry: two 1-like pillars plus a V, reading as a single M.
// No fonts, browser, ImageMagick, platform renderer, or package dependency.
export const iconSizes = [16, 24, 32, 48, 64, 128, 256]
const background = [33, 31, 41]
const ivory = [255, 247, 237]
const coral = [239, 128, 98]
const radius = 3.5
const pillars = [[20, 18, 20, 46], [44, 18, 44, 46]]
const vee = [[20, 18, 32, 35], [32, 35, 44, 18]]
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#211f29"/>
  <path d="M20 46V18M44 46V18" fill="none" stroke="#fff7ed" stroke-width="7" stroke-linecap="round"/>
  <path d="M20 18L32 35L44 18" fill="none" stroke="#ef8062" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`
function distance(x, y, [ax, ay, bx, by]) {
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay))
}
function sample(x, y) {
  const cx = Math.max(14, Math.min(50, x))
  const cy = Math.max(14, Math.min(50, y))
  if (Math.hypot(x - cx, y - cy) > 14) return null
  if (vee.some(line => distance(x, y, line) <= radius)) return coral
  if (pillars.some(line => distance(x, y, line) <= radius)) return ivory
  return background
}
function raster(size) {
  const bytes = Buffer.alloc(size * (1 + size * 4))
  // Fixed 4x4 supersampling; alpha uses premultiplied accumulation for clean edges.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0]
    let count = 0
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const color = sample((x + (sx + 0.5) / 4) * 64 / size, (y + (sy + 0.5) / 4) * 64 / size)
      if (color) { count++; color.forEach((c, i) => { sum[i] += c }) }
    }
    const offset = y * (1 + size * 4) + 1 + x * 4
    if (count) {
      sum.forEach((value, i) => { bytes[offset + i] = Math.round(value / count) })
      bytes[offset + 3] = Math.round(255 * count / 16)
    }
  }
  return bytes
}
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, bytes) {
  const name = Buffer.from(type, 'ascii')
  const head = Buffer.alloc(4); head.writeUInt32BE(bytes.length)
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes])))
  return Buffer.concat([head, name, bytes, checksum])
}
function storedZlib(bytes) {
  // Hand-encoded DEFLATE stored blocks avoid zlib-version compression drift.
  const blocks = [Buffer.from([0x78, 0x01])]
  for (let start = 0; start < bytes.length; start += 65535) {
    const n = Math.min(65535, bytes.length - start)
    const header = Buffer.alloc(5)
    header[0] = start + n === bytes.length ? 1 : 0
    header.writeUInt16LE(n, 1); header.writeUInt16LE(n ^ 0xffff, 3)
    blocks.push(header, bytes.subarray(start, start + n))
  }
  let a = 1, b = 0
  for (const byte of bytes) { a = (a + byte) % 65521; b = (b + a) % 65521 }
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((b * 65536 + a) >>> 0)
  return Buffer.concat([...blocks, checksum])
}
function png(size) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4)
  header[8] = 8; header[9] = 6 // RGBA, no palette
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', storedZlib(raster(size))), chunk('IEND', Buffer.alloc(0))])
}
export function createBrandAssets() {
  const images = iconSizes.map(png)
  const directory = Buffer.alloc(6 + images.length * 16)
  directory.writeUInt16LE(1, 2); directory.writeUInt16LE(images.length, 4)
  let offset = directory.length
  images.forEach((image, i) => {
    const pos = 6 + i * 16
    directory[pos] = iconSizes[i] % 256; directory[pos + 1] = iconSizes[i] % 256
    directory.writeUInt16LE(1, pos + 4); directory.writeUInt16LE(32, pos + 6)
    directory.writeUInt32LE(image.length, pos + 8); directory.writeUInt32LE(offset, pos + 12)
    offset += image.length
  })
  return { svg, ico: Buffer.concat([directory, ...images]), previews: images }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = path.resolve(import.meta.dirname, '..')
  const assets = createBrandAssets()
  await writeFile(path.join(root, 'public/elevenmd-mark.svg'), assets.svg)
  await writeFile(path.join(root, 'public/elevenmd.ico'), assets.ico)
  if (process.argv[2]) {
    const dir = path.resolve(process.argv[2])
    await mkdir(dir, { recursive: true })
    for (let i = 0; i < iconSizes.length; i++) await writeFile(path.join(dir, `elevenmd-${iconSizes[i]}.png`), assets.previews[i])
  }
  console.log(`Generated ElevenMD SVG and ICO (${iconSizes.join(', ')} px).`)
}
