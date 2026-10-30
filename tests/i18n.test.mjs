import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LOCALE, locales, dictionaries, normalizeLocale, translate } from '../src/i18n.js'

test('defaults and locale selection are deterministic', () => {
  assert.equal(DEFAULT_LOCALE, 'en')
  assert.deepEqual(locales, ['en', 'pt-BR'])
  assert.equal(normalizeLocale('pt-br'), 'pt-BR')
  assert.equal(normalizeLocale('fr'), 'en')
  assert.equal(normalizeLocale(null), 'en')
})

test('dictionary keys and placeholders match in both languages', () => {
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries['pt-BR']).sort())
  for (const key of Object.keys(dictionaries.en)) {
    assert.ok(dictionaries.en[key] && dictionaries['pt-BR'][key], key)
    const placeholders = text => [...text.matchAll(/\{([\w]+)\}/g)].map(m => m[1]).sort()
    assert.deepEqual(placeholders(dictionaries.en[key]), placeholders(dictionaries['pt-BR'][key]), key)
  }
})

test('translates dynamic values as literal text and safely falls back', () => {
  assert.equal(translate('pt-BR', 'Close {name}', { name: '<a>$&' }), 'Fechar <a>$&')
  assert.equal(translate('en', '{count} replaced', { count: 0 }), '0 replaced')
  assert.equal(translate('pt-BR', 'Close {name}'), 'Fechar {name}')
  assert.equal(translate('unknown', 'Save'), 'Save')
  assert.equal(translate('pt-BR', 'unknown.key'), 'unknown.key')
  assert.equal(translate('pt-BR', '__proto__'), '__proto__')
})
