export function macBundleInfo(info, version, helper, repository = 'FullPotionStack/ElevenMD') {
  const identifier = `io.github.${repository.replace('/', '.').toLowerCase()}`
  const name = helper === undefined ? 'ElevenMD' : `ElevenMD Helper${helper ? ` (${helper})` : ''}`
  return {
    ...info,
    CFBundleDisplayName: name,
    CFBundleName: name,
    CFBundleIdentifier: helper === undefined ? identifier : `${identifier}.helper${helper ? `.${helper.toLowerCase()}` : ''}`,
    CFBundleVersion: version,
    CFBundleShortVersionString: version,
    ...(helper === undefined ? { CFBundleExecutable: 'ElevenMD', CFBundleIconFile: 'elevenmd.icns' } : {}),
  }
}
