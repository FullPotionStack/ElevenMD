import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

test('native dialogs support Brazilian Portuguese with literal interpolation', () => {
  const locale = require('../electron/locale.cjs').createNativeLocale()
  assert.equal(locale.t('Open'), 'Open')
  locale.set('pt-BR')
  assert.equal(locale.t('Open'), 'Abrir')
  assert.equal(locale.t('Do you want to save changes to {name}?', { name: '<test>' }), 'Deseja salvar as alterações em <test>?')
  locale.set('unknown')
  assert.equal(locale.t('Cancel'), 'Cancel')
})
