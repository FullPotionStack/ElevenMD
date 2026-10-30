import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Approved concept coordinates, shared by SVG and the independent RGBA sampler.
// All lettering is vector geometry: no fonts, platform renderer, or dependencies.
export const documentIconSizes = [16, 24, 32, 48, 64, 128, 256]
const colors = {
  paper: '#fff7ed', outline: '#655d65', fold: '#e5dcd2',
  muted: '#9b9091', charcoal: '#49424e', coral: '#ef8062', ink: '#211f29',
}
const polygon = (points, fill, stroke, width = 0) => ({ contours: [points], fill, stroke, width })
const line = (points, stroke, width) => ({ points, stroke, width })
const rect = (x, y, w, h, fill, radius = 0) => ({ x, y, w, h, fill, radius })
const glyph = (contours, fill) => ({ contours, fill, width: 0 })

function artwork(kind) {
  const markdown = kind === 'markdown'
  const readonly = kind === 'rtf' || kind === 'pdf'
  const shapes = [
    polygon([[10, 3], [39, 3], [54, 18], [54, 60], [10, 60]], colors.paper, colors.outline, 1.5),
    polygon([[39, 3], [39, 18], [54, 18]], colors.fold),
    line([[39, 3], [39, 18], [54, 18]], colors.outline, 1.2),
  ]
  const strokes = markdown ? [[24, 34, 3], [31, 44, 1.7], [36, 38, 1.7]] : [[24, 44, 1.7], [30, 40, 1.7], [36, 44, 1.7]]
  for (const [y, end, width] of strokes) shapes.push(rect(17, y - width / 2, end - 17, width, markdown && y === 24 ? colors.charcoal : colors.muted))
  shapes.push(rect(14, 42, 45, 17, markdown ? colors.coral : readonly ? (kind === 'rtf' ? '#805a96' : '#ba5149') : colors.charcoal, 2.5))
  if (markdown) {
    shapes.push(glyph([[[26, 54.8], [26, 46.2], [27.6, 46.2], [30.7, 52.2], [33.8, 46.2], [35.4, 46.2], [35.4, 54.8], [34, 54.8], [34, 48.4], [31.3, 53.6], [30.1, 53.6], [27.4, 48.4], [27.4, 54.8]]], colors.ink))
    // D uses nested contours (even-odd fill) with a smoothly sampled elliptical bowl.
    const bowl = (x, y, rx, ry) => Array.from({ length: 25 }, (_, i) => {
      const angle = -Math.PI / 2 + Math.PI * i / 24
      return [Number((x + rx * Math.cos(angle)).toFixed(6)), Number((y + ry * Math.sin(angle)).toFixed(6))]
    })
    shapes.push(glyph([
      [[37.4, 46.2], ...bowl(41, 50.5, 4.8, 4.3), [37.4, 54.8]],
      [[38.8, 47.5], ...bowl(41, 50.5, 3.3, 3), [38.8, 53.5]],
    ], colors.ink))
  } else if (!readonly) {
    // Compact TXT capitals, centered in the same wide badge as MD.
    const tee = x => [[x, 46.5], [x + 6.6, 46.5], [x + 6.6, 47.8], [x + 4, 47.8], [x + 4, 54.5], [x + 2.6, 54.5], [x + 2.6, 47.8], [x, 47.8]]
    shapes.push(glyph([tee(26.2)], colors.paper))
    shapes.push(glyph([[[33.4, 46.5], [35, 46.5], [37.1, 49.5], [39.2, 46.5], [40.8, 46.5], [37.9, 50.4], [41, 54.5], [39.3, 54.5], [37.1, 51.3], [34.9, 54.5], [33.2, 54.5], [36.3, 50.4]]], colors.paper))
    shapes.push(glyph([tee(41.4)], colors.paper))
  } else {
    const letters = kind === 'rtf' ? ['R', 'T', 'F'] : ['P', 'D', 'F']
    const strokes = {
      R: [[[0,0],[0,8]], [[0,0],[4,0],[5,1],[5,3],[4,4],[0,4]], [[3,4],[5,8]]],
      T: [[[0,0],[6,0]], [[3,0],[3,8]]],
      F: [[[0,0],[0,8]], [[0,0],[5,0]], [[0,4],[4,4]]],
      P: [[[0,8],[0,0],[4,0],[5,1],[5,3],[4,4],[0,4]]],
      D: [[[0,0],[0,8],[3,8],[5,6],[5,2],[3,0],[0,0]]],
    }
    letters.forEach((letter, i) => strokes[letter].forEach(points => shapes.push(line(points.map(([x,y]) => [26 + i * 7 + x, 46.5 + y]), colors.paper, 1.3))))
    shapes.push(line([[44.5,19.5],[44.5,17],[45.5,15],[47.5,14],[49.5,15],[50.5,17],[50.5,19.5]], colors.ink, 1.8))
    shapes.push({ ...rect(42, 19, 12, 11, colors.ink, 1.2), readonlyLock: true })
    shapes.push(rect(47.2, 21.5, 1, 2, colors.paper, 0.5))
  }
  return shapes
}
const pathData = points => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')
function svgFor(shapes) {
  const elements = shapes.map(shape => {
    if ('x' in shape) return `  <rect${shape.readonlyLock ? ' data-readonly-lock="true"' : ''} x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="${shape.radius}" fill="${shape.fill}"/>`
    const d = shape.contours ? shape.contours.map(points => `${pathData(points)}Z`).join('') : pathData(shape.points)
    const stroke = shape.stroke ? ` stroke="${shape.stroke}" stroke-width="${shape.width}" stroke-linecap="round" stroke-linejoin="round"` : ''
    return `  <path d="${d}" fill="${shape.fill ?? 'none'}" fill-rule="evenodd"${stroke}/>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n${elements.join('\n')}\n</svg>\n`
}
function inside(x, y, points) {
  let result = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i], [bx, by] = points[j]
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) result = !result
  }
  return result
}
function near(x, y, a, b, radius) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
  return (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2 <= radius ** 2
}
function sampler(shapes) {
  const rgb = hex => hex.match(/[a-f0-9]{2}/g).map(n => parseInt(n, 16))
  const layers = shapes.map(shape => {
    const points = shape.contours?.flat() ?? shape.points
    const pad = (shape.width ?? 0) / 2
    const bounds = points ? [Math.min(...points.map(p => p[0])) - pad, Math.min(...points.map(p => p[1])) - pad, Math.max(...points.map(p => p[0])) + pad, Math.max(...points.map(p => p[1])) + pad] : [shape.x, shape.y, shape.x + shape.w, shape.y + shape.h]
    return { ...shape, bounds, fillRGB: shape.fill && rgb(shape.fill), strokeRGB: shape.stroke && rgb(shape.stroke) }
  }).reverse()
  return (x, y) => {
    for (const shape of layers) {
      const [left, top, right, bottom] = shape.bounds
      if (x < left || x > right || y < top || y > bottom) continue
      if ('x' in shape) {
        const r = shape.radius
        const cx = Math.max(left + r, Math.min(right - r, x))
        const cy = Math.max(top + r, Math.min(bottom - r, y))
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) return shape.fillRGB
      } else {
        if (shape.stroke) {
          const points = shape.contours?.[0] ?? shape.points
          const count = shape.contours ? points.length : points.length - 1
          for (let i = 0; i < count; i++) if (near(x, y, points[i], points[(i + 1) % points.length], shape.width / 2)) return shape.strokeRGB
        }
        if (shape.fill && shape.contours.reduce((hit, contour) => hit !== inside(x, y, contour), false)) return shape.fillRGB
      }
    }
    return null
  }
}
function raster(size, sample) {
  const bytes = Buffer.alloc(size * (1 + size * 4))
  // 4x4 coverage supersampling, accumulating premultiplied colors for fringe-free alpha.
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
// Minimal deterministic PNG/ICO encoding copied from generate-brand-assets.mjs.
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
  // Stored DEFLATE blocks avoid compression-library version drift.
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
function png(size, sample) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4)
  header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', storedZlib(raster(size, sample))), chunk('IEND', Buffer.alloc(0))])
}
export function createDocumentAssets(kind) {
  if (!['markdown', 'text', 'rtf', 'pdf'].includes(kind)) throw new TypeError('Unknown document icon kind.')
  const shapes = artwork(kind)
  const sample = sampler(shapes)
  const images = documentIconSizes.map(size => png(size, sample))
  const directory = Buffer.alloc(6 + images.length * 16)
  directory.writeUInt16LE(1, 2); directory.writeUInt16LE(images.length, 4)
  let offset = directory.length
  images.forEach((image, i) => {
    const pos = 6 + i * 16
    directory[pos] = documentIconSizes[i] % 256; directory[pos + 1] = documentIconSizes[i] % 256
    directory.writeUInt16LE(1, pos + 4); directory.writeUInt16LE(32, pos + 6)
    directory.writeUInt32LE(image.length, pos + 8); directory.writeUInt32LE(offset, pos + 12)
    offset += image.length
  })
  return { svg: svgFor(shapes), ico: Buffer.concat([directory, ...images]), previews: images }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = path.resolve(import.meta.dirname, '..')
  const previewDir = process.argv[2] && path.resolve(process.argv[2])
  if (previewDir) await mkdir(previewDir, { recursive: true })
  for (const kind of ['markdown', 'text', 'rtf', 'pdf']) {
    const assets = createDocumentAssets(kind)
    await writeFile(path.join(root, `public/elevenmd-${kind}.svg`), assets.svg)
    await writeFile(path.join(root, `public/elevenmd-${kind}.ico`), assets.ico)
    if (previewDir) for (const [i, size] of documentIconSizes.entries()) await writeFile(path.join(previewDir, `elevenmd-${kind}-${size}.png`), assets.previews[i])
  }
  console.log(`Generated ElevenMD document SVGs and ICOs (${documentIconSizes.join(', ')} px).`)
}
