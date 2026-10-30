import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export async function collectNotices(root, lock) {
  let notices = ''
  for (const [relative, info] of Object.entries(lock.packages)) {
    if (!relative || info.dev) continue
    let dir = path.join(root, relative), names
    try { names = await readdir(dir) } catch (error) {
      if (info.optional && error.code === 'ENOENT') continue
      throw error
    }
    names = names.filter(name => /^(license|copying|notice)([.-]|$)/i.test(name)).sort()
    // The canvas platform package contains only its native binary. The shared
    // upstream package supplies the MIT license; neither binary is bundled into
    // the renderer, but include that license when the optional package exists.
    if (!names.length && info.optional && /^node_modules\/@napi-rs\/canvas-/.test(relative)) {
      dir = path.join(root, 'node_modules', '@napi-rs', 'canvas')
      names = (await readdir(dir)).filter(name => /^(license|copying|notice)([.-]|$)/i.test(name)).sort()
    }
    if (!names.length) throw new Error(`Missing license text for ${relative}`)
    notices += `\n${'='.repeat(72)}\n${relative} ${info.version} (${info.license})\n`
    for (const name of names) notices += `\n${name}\n${await readFile(path.join(dir, name), 'utf8')}\n`
  }
  return notices
}
