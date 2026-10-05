export function validateDistribution(config, originURL) {
  if (!config || typeof config.repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(config.repository) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(config.installerPrefix || '')) throw new Error('Invalid distribution configuration.')
  const origin = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?$/.exec(originURL || '')?.[1]
  if (!origin || origin.toLowerCase() !== config.repository.toLowerCase()) throw new Error('Distribution repository does not match git origin. Forks MUST change electron/distribution.cjs to their own update repository; do not ship builds targeting upstream.')
  return true
}
