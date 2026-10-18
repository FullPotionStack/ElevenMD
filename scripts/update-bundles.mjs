import { writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const { inventory, createBundle } = createRequire(import.meta.url)('../electron/update-bundle.cjs')
export async function markRuntime({ root, platform, arch, route, executable }) {
  const entries = await inventory(root)
  const markerPath = platform === 'darwin' ? 'Contents/Resources/.elevenmd-managed.json' : '.elevenmd-managed.json'
  const marker = { schema: 1, platform, arch, route, executable, owned: [...entries.map(e => e.path), markerPath].filter((p, i, a) => a.indexOf(p) === i).sort() }
  await writeFile(path.join(root, markerPath), JSON.stringify(marker), { flag: 'wx' })
}
export async function emitUpdateBundle({ root, release, prefix, version, platform, arch, route, executable }) {
  const stem = `${prefix}-${version}-${platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : platform}-${arch}-update`
  const bundle = path.join(release, `${stem}.bundle.gz`), descriptor = path.join(release, `${stem}.json`)
  for (const file of [bundle, descriptor]) {
    try { await access(file) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    throw new Error(`Update artifact already exists: ${file}`)
  }
  const result = await createBundle({ root, destination: bundle, version, repository: arguments[0].repository, platform, arch, route, executable })
  await writeFile(descriptor, JSON.stringify({ schema: 1, asset: path.basename(bundle), size: result.size, sha256: result.sha256, manifest: result.manifest }), { flag: 'wx' })
  return { bundle, descriptor }
}
