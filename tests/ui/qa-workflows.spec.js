import { test, expect } from '@playwright/test'

// Independent user journeys. Only the desktop boundary is simulated; the renderer,
// keyboard, selections, Markdown parser, dialogs and browser storage are real.
// No fixture represents a user file, and no native dialog/filesystem is exercised.
const button = (page, name) => page.getByRole('button', { name, exact: true })
const rich = page => page.getByRole('textbox', { name: 'Formatted Markdown', exact: true })
const source = page => page.getByRole('textbox', { name: 'Markdown source', exact: true })
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII='
const advanced = '---\r\ntitle: Exact private fixture\r\n---\r\n\r\n<!-- retain this comment -->\r\n# Notes\r\n\r\nA footnote[^1] and $x^2$.\r\n\r\n[^1]: Keep two  spaces.\r\n\r\nTerm\r\n: Definition\r\n\r\n```js\r\nconst x = "<safe>";\r\n```\r\n'

async function menu(page, name, item) {
  await button(page, name).click()
  await page.getByRole('menuitem', { name: item }).click()
}
async function screenshot(page, info, name) {
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await info.attach(name, { path, contentType: 'image/png' })
}
async function writeSource(page, text) {
  await button(page, 'Source').click()
  await source(page).fill(text)
}
async function bridge(page, files = []) {
  await page.addInitScript(({ files, png }) => {
    window.qa = { opens: 0, saves: [], closeAnswers: [], confirms: [], links: [], imports: [], resolutions: [], snapshots: [], closed: false, saveOutcome: 'ok', fixtureFiles: files }
    window.notepad = {
      initialFiles: async () => [], restoreSession: async () => null,
      open: async () => { window.qa.opens++; return structuredClone(window.qa.fixtureFiles) },
      save: async payload => {
        window.qa.saves.push(structuredClone(payload))
        if (window.qa.saveOutcome === 'cancel') return null
        if (window.qa.saveOutcome === 'error') throw new Error('Fixture external-change conflict: save was not written')
        return { id: payload.id, name: payload.saveAs ? 'copy.md' : 'saved.md', path: 'QA-ONLY:/saved.md', eol: 'LF', bom: false }
      },
      setDirty: value => { window.qa.dirty = value },
      confirmClose: async name => { window.qa.confirms.push(name); return window.qa.closeAnswers.shift() || 'cancel' },
      closeWindow: async () => { window.qa.closed = true },
      onAction: callback => { window.qa.action = callback },
      saveSession: async payload => { window.qa.snapshots.push(structuredClone(payload)); return { stored: true } },
      preferences: async payload => { window.qa.preferences = payload },
      openLink: async href => { window.qa.links.push(href) },
      importImage: async payload => { window.qa.imports.push(payload); return { source: 'qa.assets/pixel.png' } },
      resolveImage: async payload => { window.qa.resolutions.push(payload); return { src: png, mime: 'image/png' } },
    }
  }, { files, png })
}

test.beforeEach(async ({ page }) => {
  page.qaErrors = []
  page.on('pageerror', error => page.qaErrors.push(error.message))
})
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await screenshot(page, info, 'final-state')
  expect(page.qaErrors, 'No renderer exceptions during the journey').toEqual([])
})

test('quick private draft: type, switch tabs, recover browser session without saving a file', async ({ page }, info) => {
  await page.goto('/')
  await rich(page).pressSequentially('Private fixture: call the dentist tomorrow.')
  await expect(page.getByRole('tab', { name: 'Untitled 1', exact: true })).toHaveAttribute('data-dirty', 'true')
  await expect(page.locator('#file-status')).toHaveText('Unsaved changes')
  await page.keyboard.press('Control+n')
  await rich(page).pressSequentially('Second private fixture.')
  await page.keyboard.press('Control+Shift+Tab')
  await expect(rich(page)).toHaveText('Private fixture: call the dentist tomorrow.')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('notepad-session'))?.tabs.length)).toBe(2)
  await page.reload()
  await expect(rich(page)).toHaveText('Private fixture: call the dentist tomorrow.')
  await expect(page.getByRole('tab')).toHaveCount(2)
  await screenshot(page, info, 'private-draft-recovered')
  await page.keyboard.press('Control+s')
  await expect(page.locator('#toast')).toContainText('desktop app to save')
  await page.keyboard.press('Control+w')
  await expect(page.getByRole('tab')).toHaveCount(2)
})

test('README: source, formatted edit, preview semantic content and exact source before edit', async ({ page }, info) => {
  const readme = '# My project\n\nA **local** tool with *small* dependencies and ~~old~~ `commands`.\n\n## Install\n\n```bash\nnpm install\n```\n\n> Keep files local.\n\n1. Open a file\n2. Write a note\n\n- Portable\n- Offline\n\n[Documentation](https://example.com/docs)\n\n---\n'
  await page.goto('/')
  await writeSource(page, readme)
  await button(page, 'Formatted').click()
  await expect(page.locator('.tiptap h1')).toHaveText('My project')
  await expect(page.locator('.tiptap strong')).toHaveText('local')
  await button(page, 'Preview').click()
  await expect(page.locator('#preview h2')).toHaveText('Install')
  await expect(page.locator('#preview pre code')).toHaveText('npm install\n')
  await expect(page.locator('#preview blockquote')).toContainText('Keep files local.')
  await expect(page.locator('#preview ol li')).toHaveCount(2)
  await expect(page.locator('#preview ul li')).toHaveCount(2)
  await expect(page.locator('#preview hr')).toHaveCount(1)
  await screenshot(page, info, 'readme-preview-light')
  await button(page, 'Source').click()
  await expect(source(page)).toHaveValue(readme)
  await button(page, 'Formatted').click()
  await rich(page).press('Control+End')
  await rich(page).pressSequentially('Release notes soon.')
  await button(page, 'Source').click()
  await expect(source(page)).toHaveValue(/Release notes soon\./)
})

for (const [name, selector, syntax] of [['Bold', 'strong', '**'], ['Italic', 'em', '*'], ['Strikethrough', 's', '~~'], ['Inline code', 'code', '`']]) {
  test(`toolbar ${name}: selected text gains mark, toggles off, undo and redo`, async ({ page }) => {
    await page.goto('/')
    await rich(page).pressSequentially('Release candidate')
    await rich(page).press('Control+a')
    await button(page, name).click()
    await expect(page.locator(`.tiptap ${selector}`)).toHaveText('Release candidate')
    await button(page, name).click()
    await expect(page.locator(`.tiptap ${selector}`)).toHaveCount(0)
    await menu(page, 'Edit', /^Undo/)
    await expect(page.locator(`.tiptap ${selector}`)).toHaveText('Release candidate')
    await menu(page, 'Edit', /^Redo/)
    await expect(page.locator(`.tiptap ${selector}`)).toHaveCount(0)
    await button(page, name).click()
    await button(page, 'Source').click()
    await expect(source(page)).toHaveValue(`${syntax}Release candidate${syntax}`)
  })
}

test('toolbar block styles: all six headings, paragraph, quote, code and horizontal rule', async ({ page }) => {
  await page.goto('/')
  await rich(page).pressSequentially('Structure')
  for (let level = 1; level <= 6; level++) {
    await page.getByRole('combobox', { name: 'Block style' }).selectOption(`h${level}`)
    await expect(page.locator(`.tiptap h${level}`)).toHaveText('Structure')
  }
  await page.getByRole('combobox', { name: 'Block style' }).selectOption('p')
  await expect(page.locator('.tiptap > p').first()).toHaveText('Structure')
  await button(page, 'Quote').click()
  await expect(page.locator('.tiptap blockquote')).toHaveText('Structure')
  await button(page, 'Quote').click()
  await button(page, 'Code block').click()
  await expect(page.locator('.tiptap pre code')).toHaveText('Structure')
  await button(page, 'Code block').click()
  await rich(page).press('Control+End')
  await button(page, 'Horizontal rule').click()
  await expect(page.locator('.tiptap hr')).toHaveCount(1)
  await button(page, 'Source').click()
  await expect(source(page)).toHaveValue(/Structure[\s\S]*---/)
})

for (const [from, to] of [['Task list', 'Bullet list'], ['Task list', 'Numbered list'], ['Bullet list', 'Task list'], ['Numbered list', 'Task list'], ['Bullet list', 'Numbered list'], ['Numbered list', 'Bullet list']]) {
  test(`task planning conversion ${from} to ${to} preserves rows and text`, async ({ page }) => {
    await page.goto('/')
    await button(page, from).click()
    await rich(page).pressSequentially('Plan launch')
    await rich(page).press('Enter')
    await rich(page).pressSequentially('Review package')
    await rich(page).press('Control+a')
    await button(page, to).click()
    await expect(page.locator('.tiptap li')).toHaveCount(2)
    await expect(page.locator('.tiptap li').first()).toContainText('Plan launch')
    const task = to === 'Task list'
    await expect(page.locator('.tiptap input[type=checkbox]')).toHaveCount(task ? 2 : 0)
    if (task) await page.locator('.tiptap input[type=checkbox]').first().check()
    await button(page, 'Source').click()
    await expect(source(page)).toHaveValue(/Plan launch[\s\S]*Review package/)
    if (task) await expect(source(page)).toHaveValue(/- \[x\] Plan launch/)
    await button(page, 'Preview').click()
    await expect(page.locator('#preview li')).toHaveCount(2)
    if (task) {
      await expect(page.locator('#preview input[type=checkbox]').first()).toBeChecked()
      await expect(page.locator('#preview input[type=checkbox]').first()).toBeDisabled()
    }
  })
}

test('task list: empty next task, checked styling and nested task keyboard indentation', async ({ page }, info) => {
  await page.goto('/')
  await button(page, 'Task list').click()
  await rich(page).pressSequentially('Ship draft')
  await rich(page).press('Enter')
  await rich(page).pressSequentially('Check screenshots')
  await rich(page).press('Tab')
  await expect(page.locator('.tiptap ul[data-type=taskList] ul')).toHaveCount(1)
  await rich(page).press('Shift+Tab')
  await rich(page).press('Enter')
  await expect(page.locator('.tiptap input[type=checkbox]')).toHaveCount(3)
  await page.locator('.tiptap input[type=checkbox]').first().check()
  await expect(page.locator('.tiptap li[data-checked=true] > div').first()).toHaveCSS('text-decoration-line', 'line-through')
  await button(page, 'Preview').click()
  await expect(page.locator('#preview input[type=checkbox]')).toHaveCount(3)
  await screenshot(page, info, 'tasks-preview')
})

test('plain text: source retains literal punctuation, blank lines, tabs and Unicode through bridge Save', async ({ page }) => {
  await bridge(page)
  await page.goto('/')
  const text = 'Shopping list — café\n\n* not formatting in my text file *\n\tMilk\nPrice: $5.00\nEmoji: 📝\n'
  await writeSource(page, text)
  await menu(page, 'File', /^Save\s*Ctrl/)
  await expect.poll(() => page.evaluate(() => window.qa.saves.length)).toBe(1)
  expect(await page.evaluate(() => window.qa.saves[0].content)).toBe(text)
  await expect(source(page)).toHaveValue(text)
  await expect(page.locator('#file-status')).toHaveText('Saved')
})

test('advanced Markdown: open guard, preview math/footnotes/metadata, reject conversion and exact Save', async ({ page }, info) => {
  await bridge(page, [{ id: 'advanced-fixture', name: 'advanced.md', path: 'QA-ONLY:/advanced.md', content: advanced, eol: 'CRLF', bom: true }])
  await page.goto('/')
  await menu(page, 'File', /^Open/)
  await expect(source(page)).toBeVisible()
  await expect(source(page)).toHaveValue(advanced.replaceAll('\r\n', '\n'))
  await button(page, 'Preview').click()
  await expect(page.locator('#preview details')).toContainText('title: Exact private fixture')
  await expect(page.locator('#preview math')).toHaveCount(1)
  await expect(page.locator('#preview .footnotes')).toContainText('Keep two spaces.')
  await expect(page.locator('#preview dl')).toContainText('Definition')
  await expect(page.locator('#preview pre code.language-js')).toContainText('const x = "<safe>";')
  await screenshot(page, info, 'advanced-preview')
  await button(page, 'Formatted').click()
  await expect(page.getByRole('dialog')).toContainText('Keep this Markdown intact?')
  await button(page, 'Keep source').click()
  await button(page, 'Source').click()
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => window.qa.saves.length)).toBe(1)
  expect(await page.evaluate(() => window.qa.saves[0].content)).toBe(advanced)
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-dirty', 'false')
  await source(page).press('Control+End')
  await source(page).pressSequentially('\nExtra source-only paragraph.')
  await expect(source(page)).toHaveValue(/<!-- retain this comment -->/)
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-dirty', 'true')
})

test('link dialog: cancel preserves selection, invalid scheme rejected, insertion and preview bridge activation', async ({ page }) => {
  await bridge(page)
  await page.goto('/')
  await rich(page).pressSequentially('Read documentation')
  await rich(page).press('Control+a')
  await button(page, 'Insert link').click()
  await expect(page.getByRole('textbox', { name: 'Link text' })).toHaveValue('Read documentation')
  await button(page, 'Cancel').click()
  await expect(rich(page)).toHaveText('Read documentation')
  await button(page, 'Insert link').click()
  await page.getByRole('textbox', { name: 'Link destination' }).fill('javascript:alert(1)')
  await button(page, 'Insert').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('#toast')).toContainText('HTTP(S)')
  await page.getByRole('textbox', { name: 'Link destination' }).fill('https://example.com/docs')
  await button(page, 'Insert').click()
  await expect(page.locator('.tiptap a')).toHaveText('Read documentation')
  await button(page, 'Source').click()
  await expect(source(page)).toHaveValue('[Read documentation](https://example.com/docs)')
  await button(page, 'Preview').click()
  await page.locator('#preview a').click()
  expect(await page.evaluate(() => window.qa.links)).toEqual(['https://example.com/docs'])
})

test('image dialog: blocked URL, cancel, local bridge import saves unnamed draft and keeps logical path', async ({ page }, info) => {
  await bridge(page)
  await page.goto('/')
  await rich(page).pressSequentially('Illustration')
  await rich(page).press('Control+End')
  await button(page, 'Insert image').click()
  await page.getByRole('textbox', { name: 'Image URL' }).fill('http://example.com/unsafe.png')
  await button(page, 'Insert').click()
  await expect(page.locator('#toast')).toContainText('HTTPS image URL')
  await button(page, 'Cancel').click()
  await expect(page.locator('.tiptap img')).toHaveCount(0)
  await button(page, 'Insert image').click()
  await page.getByRole('textbox', { name: 'Image alt text' }).fill('QA pixel')
  await page.getByRole('textbox', { name: 'Image title' }).fill('Fixture title')
  await button(page, 'Choose local image…').click()
  await expect(page.locator('.tiptap img')).toHaveAttribute('alt', 'QA pixel')
  await expect.poll(() => page.locator('.tiptap img').evaluate(el => el.naturalWidth)).toBe(1)
  expect(await page.evaluate(() => window.qa.saves.length)).toBe(1)
  expect(await page.evaluate(() => window.qa.imports.length)).toBe(1)
  await button(page, 'Source').click()
  await expect(source(page)).toHaveValue(/!\[QA pixel\]\(qa.assets\/pixel.png "Fixture title"\)/)
  await expect(source(page)).not.toHaveValue(/data:image/)
  await button(page, 'Preview').click()
  await expect.poll(() => page.locator('#preview img').evaluate(el => el.naturalWidth)).toBe(1)
  await screenshot(page, info, 'local-image-preview-stubbed')
})

test('remote image: privacy default blocks network, explicit setting enables fixture request', async ({ page }) => {
  let requests = 0
  await page.route('https://example.com/qa-image.png', route => { requests++; return route.fulfill({ contentType: 'image/png', body: Buffer.from(png.split(',')[1], 'base64') }) })
  await page.goto('/')
  await button(page, 'Insert image').click()
  await page.getByRole('textbox', { name: 'Image URL' }).fill('https://example.com/qa-image.png')
  await page.getByRole('textbox', { name: 'Image alt text' }).fill('Remote fixture')
  await button(page, 'Insert').click()
  await expect(page.locator('.image-message')).toContainText('Remote images blocked')
  expect(requests).toBe(0)
  await button(page, 'Settings').click()
  await page.getByRole('checkbox', { name: 'Load remote images' }).check()
  await button(page, 'Done').click()
  await expect.poll(() => page.locator('.tiptap img').evaluate(el => el.naturalWidth)).toBe(1)
  expect(requests).toBeGreaterThan(0)
  await button(page, 'Preview').click()
  await expect.poll(() => page.locator('#preview img').evaluate(el => el.naturalWidth)).toBe(1)
})

test('table: insert, type header cells, align header, source/preview, delete and undo', async ({ page }, info) => {
  await page.goto('/')
  await button(page, 'Insert table').click()
  const actions = page.getByRole('combobox', { name: 'Table actions' })
  await page.locator('.tiptap th').first().click()
  await page.keyboard.type('Feature')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Status')
  const feature = page.locator('.tiptap th').filter({ hasText: /^Feature$/ })
  for (const align of ['left', 'center', 'right']) {
    await feature.click()
    await actions.selectOption(`align-${align}`)
    await expect(feature).toHaveCSS('text-align', align)
  }
  await button(page, 'Source').click()
  await expect(source(page)).toHaveValue(/Feature/)
  await expect(source(page)).toHaveValue(/Status/)
  await expect(source(page)).toHaveValue(/-+:/)
  await button(page, 'Preview').click()
  await expect(page.locator('#preview tr')).toHaveCount(3)
  await expect(page.locator('#preview th').first()).toHaveText('Feature')
  await screenshot(page, info, 'edited-table-preview')
  await button(page, 'Formatted').click()
  await feature.click()
  await actions.selectOption('deleteTable')
  await expect(page.locator('.tiptap table')).toHaveCount(0)
  await menu(page, 'Edit', /^Undo/)
  await expect(page.locator('.tiptap table')).toHaveCount(1)
  await expect(feature).toHaveText('Feature')
})

// Fresh populated table per structural command: do not chain insert/delete on
// shifted empty cells and then expect deleted author's text to remain present.
for (const [action, rows, columns] of [
  ['addRowBefore', 4, 3], ['addRowAfter', 4, 3], ['deleteRow', 2, 3],
  ['addColumnBefore', 3, 4], ['addColumnAfter', 3, 4], ['deleteColumn', 3, 2],
]) {
  test(`table structural command ${action}: intended row/column changes and undo restores content`, async ({ page }) => {
    await page.goto('/')
    await writeSource(page, '| Item | Status | Owner |\n| --- | --- | --- |\n| Alpha | Draft | QA |\n| Beta | Done | Editor |\n')
    await button(page, 'Formatted').click()
    await expect(page.locator('.tiptap tr')).toHaveCount(3)
    await page.locator('.tiptap td').filter({ hasText: /^Alpha$/ }).click()
    await page.getByRole('combobox', { name: 'Table actions' }).selectOption(action)
    await expect(page.locator('.tiptap tr')).toHaveCount(rows)
    await expect(page.locator('.tiptap tr').first().locator('th,td')).toHaveCount(columns)
    if (action === 'deleteRow') {
      await expect(page.locator('.tiptap')).not.toContainText('Alpha')
      await expect(page.locator('.tiptap')).toContainText('Beta')
    } else if (action === 'deleteColumn') {
      await expect(page.locator('.tiptap')).not.toContainText('Alpha')
      await expect(page.locator('.tiptap')).toContainText('Draft')
      await expect(page.locator('.tiptap')).toContainText('Done')
    } else {
      await expect(page.locator('.tiptap')).toContainText('Alpha')
      await expect(page.locator('.tiptap')).toContainText('Beta')
    }
    await button(page, 'Source').click()
    await expect(source(page)).toHaveValue(/Status/)
    await button(page, 'Preview').click()
    await expect(page.locator('#preview tr')).toHaveCount(rows)
    await expect(page.locator('#preview tr').first().locator('th,td')).toHaveCount(columns)
    await button(page, 'Formatted').click()
    await menu(page, 'Edit', /^Undo/)
    await expect(page.locator('.tiptap tr')).toHaveCount(3)
    await expect(page.locator('.tiptap tr').first().locator('th,td')).toHaveCount(3)
    await expect(page.locator('.tiptap')).toContainText('Alpha')
    await expect(page.locator('.tiptap')).toContainText('Beta')
  })
}

test('table column alignment from a body cell agrees between Formatted and Preview', async ({ page }, info) => {
  await page.goto('/')
  await writeSource(page, '| Item | Status |\n| --- | --- |\n| Alpha | Draft |\n| Beta | Done |\n')
  await button(page, 'Formatted').click()
  await page.locator('.tiptap td').filter({ hasText: /^Alpha$/ }).click()
  await page.getByRole('combobox', { name: 'Table actions' }).selectOption('align-center')
  await screenshot(page, info, 'column-alignment-formatted')
  const cells = page.locator('.tiptap tr > :first-child')
  for (let i = 0; i < 3; i++) await expect.soft(cells.nth(i), 'Align column center applies to each row, not just one cell').toHaveCSS('text-align', 'center', { timeout: 1000 })
  await button(page, 'Preview').click()
  for (let i = 0; i < 3; i++) await expect.soft(page.locator('#preview tr > :first-child').nth(i), 'Preview column alignment matches formatted command').toHaveCSS('text-align', 'center', { timeout: 1000 })
  await screenshot(page, info, 'column-alignment-preview')
})

test('advanced conversion is explicit: accept formatted, edit text, preview and save edited result', async ({ page }) => {
  await bridge(page, [{ id: 'convert-fixture', name: 'convert.md', path: 'QA-ONLY:/convert.md', content: '<!-- source-only comment -->\n# Editable heading\n\nKeep this paragraph.\n' }])
  await page.goto('/')
  await page.keyboard.press('Control+o')
  await expect(source(page)).toBeVisible()
  await button(page, 'Formatted').click()
  await button(page, 'Use formatted').click()
  await expect(rich(page)).toBeVisible()
  await rich(page).press('Control+End')
  await page.keyboard.insertText(' Explicit converted edit.')
  await page.keyboard.press('Control+Shift+s')
  await expect.poll(() => page.evaluate(() => window.qa.saves.length)).toBe(1)
  expect(await page.evaluate(() => window.qa.saves[0].saveAs)).toBe(true)
  expect(await page.evaluate(() => window.qa.saves[0].content)).toContain('Explicit converted edit.')
  await button(page, 'Preview').click()
  await expect(page.locator('#preview')).toContainText('Explicit converted edit.')
})

for (const mode of ['Formatted', 'Source']) {
  test(`Edit Select all in ${mode} selects writing content, not app chrome`, async ({ page }) => {
    await page.goto('/')
    if (mode === 'Source') await writeSource(page, 'First fixture')
    else await rich(page).pressSequentially('First fixture')
    await menu(page, 'Edit', /^Select all/)
    // Let the editor's deferred focus settle: a selection overwritten on the next
    // animation frame is not a usable Select all action for a person.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    if (mode === 'Source') expect(await source(page).evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('First fixture')
    else expect(await page.evaluate(() => window.getSelection().toString())).toBe('First fixture')
    await page.keyboard.insertText('Replacement fixture')
    if (mode === 'Source') await expect(source(page)).toHaveValue('Replacement fixture')
    else await expect(rich(page)).toHaveText('Replacement fixture')
    await expect(button(page, 'File')).toBeVisible()
  })
}

test('File Open cancellation and error keep the unsaved writing buffer untouched', async ({ page }) => {
  await bridge(page)
  await page.goto('/')
  await rich(page).pressSequentially('Do not lose this fixture draft.')
  await page.keyboard.press('Control+o')
  await expect.poll(() => page.evaluate(() => window.qa.opens)).toBe(1)
  await expect(rich(page)).toHaveText('Do not lose this fixture draft.')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await page.evaluate(() => { window.notepad.open = async () => { throw new Error('Fixture open permission denied') } })
  await menu(page, 'File', /^Open/)
  await expect(page.locator('#toast')).toHaveText('Fixture open permission denied')
  await expect(rich(page)).toHaveText('Do not lose this fixture draft.')
})

test('find/replace: literal case-insensitive search, wrap, one/all, no match, source undo and close focus', async ({ page }) => {
  await page.goto('/')
  const text = '# Release\n\n**Cat** cat CAT. a.b aXb.\n'
  await writeSource(page, text)
  await menu(page, 'Edit', /^Find/)
  await page.getByRole('textbox', { name: 'Find text' }).fill('cat')
  const positions = []
  for (let i = 0; i < 4; i++) {
    await button(page, 'Next').click()
    positions.push(await source(page).evaluate(el => el.selectionStart))
  }
  expect(positions[0]).toBe(positions[3])
  expect(new Set(positions.slice(0, 3)).size).toBe(3)
  await menu(page, 'Edit', /^Replace/)
  await page.getByRole('textbox', { name: 'Find text' }).fill('a.b')
  await page.getByRole('textbox', { name: 'Replace with' }).fill('$& literal')
  await button(page, 'Replace').click()
  await expect(source(page)).toHaveValue(/\$& literal aXb/)
  await page.getByRole('textbox', { name: 'Find text' }).fill('cat')
  await page.getByRole('textbox', { name: 'Replace with' }).fill('Dog')
  await button(page, 'Replace all').click()
  await expect(page.locator('#find-result')).toHaveText('3 replaced')
  await expect(source(page)).toHaveValue(/\*\*Dog\*\* Dog Dog/)
  await menu(page, 'Edit', /^Undo/)
  await expect(source(page)).toHaveValue(/\*\*Cat\*\* cat CAT/)
  await menu(page, 'Edit', /^Redo/)
  await expect(source(page)).toHaveValue(/\*\*Dog\*\* Dog Dog/)
  await page.getByRole('textbox', { name: 'Find text' }).fill('not-in-document')
  await button(page, 'Next').click()
  await expect(page.locator('#find-result')).toHaveText('No matches')
  await button(page, 'Close find').click()
  await expect(source(page)).toBeFocused()
  await expect(page.locator('#find-bar')).toBeHidden()
})

for (const mode of ['Formatted', 'Source']) {
  test(`undo isolation across tabs in ${mode} does not resurrect another private draft`, async ({ page }) => {
    await page.goto('/')
    await button(page, mode).click()
    const field = mode === 'Source' ? source(page) : rich(page)
    await field.focus()
    await page.keyboard.insertText('PRIVATE ALPHA') // A real paste-sized input, not an assumed typing undo group.
    await page.waitForTimeout(600) // Separate actual editor history groups.
    await page.keyboard.press('Control+n')
    await field.focus()
    await page.keyboard.insertText('PUBLIC BETA')
    await page.waitForTimeout(600)
    await page.getByRole('tab', { name: 'Untitled 1', exact: true }).click()
    await field.click()
    await field.press('Control+End')
    await page.keyboard.insertText(' edited')
    await page.waitForTimeout(600)
    await menu(page, 'Edit', /^Undo/)
    if (mode === 'Source') await expect(field).toHaveValue('PRIVATE ALPHA')
    else await expect(field).toHaveText('PRIVATE ALPHA')
    await page.getByRole('tab', { name: 'Untitled 2', exact: true }).click()
    if (mode === 'Source') await expect(field).toHaveValue('PUBLIC BETA')
    else await expect(field).toHaveText('PUBLIC BETA')
    await menu(page, 'Edit', /^Undo/)
    if (mode === 'Source') await expect(field).toHaveValue('')
    else await expect(field).toHaveText('')
    await page.getByRole('tab', { name: 'Untitled 1', exact: true }).click()
    if (mode === 'Source') await expect(field).toHaveValue('PRIVATE ALPHA')
    else await expect(field).toHaveText('PRIVATE ALPHA')
  })
}

test('File menu: new/open duplicate/Save/Save as, cancel/error, close cancel/save/discard and Exit checkpoint', async ({ page }) => {
  await bridge(page, [{ id: 'file-fixture', name: 'fixture.md', path: 'QA-ONLY:/fixture.md', content: '# Fixture', eol: 'LF', bom: false }])
  await page.goto('/')
  await menu(page, 'File', /^Open/)
  await expect(page.getByRole('tab')).toHaveCount(1)
  await menu(page, 'File', /^Open/)
  await expect(page.getByRole('tab')).toHaveCount(1)
  await writeSource(page, '# Edited fixture')
  await page.evaluate(() => { window.qa.saveOutcome = 'cancel' })
  await menu(page, 'File', /^Save\s*Ctrl/)
  await expect.poll(() => page.evaluate(() => window.qa.saves.length)).toBe(1)
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-dirty', 'true')
  await page.evaluate(() => { window.qa.saveOutcome = 'error' })
  await menu(page, 'File', /^Save\s*Ctrl/)
  await expect(page.locator('#toast')).toContainText('external-change conflict')
  await expect(source(page)).toHaveValue('# Edited fixture')
  await page.evaluate(() => { window.qa.saveOutcome = 'ok' })
  await menu(page, 'File', /^Save\s*Ctrl/)
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-dirty', 'false')
  await menu(page, 'File', /^Save as/)
  await expect(page.getByRole('tab', { name: 'copy.md', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.qa.saves.at(-1).saveAs)).toBe(true)
  await menu(page, 'File', /^New tab/)
  await source(page).pressSequentially('Disposable fixture')
  await menu(page, 'File', /^Close tab/)
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.evaluate(() => { window.qa.closeAnswers = ['save'] })
  await menu(page, 'File', /^Close tab/)
  await expect(page.getByRole('tab')).toHaveCount(1)
  expect(await page.evaluate(() => window.qa.saves.at(-1).content)).toBe('Disposable fixture')
  await menu(page, 'File', /^New tab/)
  await source(page).pressSequentially('Discard only this fixture')
  await page.evaluate(() => { window.qa.closeAnswers = ['discard'] })
  await page.keyboard.press('Control+w')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await source(page).press('Control+End')
  await source(page).pressSequentially(' unsaved at exit')
  await menu(page, 'File', /^Exit/)
  await expect.poll(() => page.evaluate(() => window.qa.closed)).toBe(true)
  expect(await page.evaluate(() => window.qa.snapshots.at(-1).tabs[0].content)).toBe('# Edited fixture unsaved at exit')
})

test('Settings and View: themes/fonts/sizes/wrap/spellcheck, persistence, all modes and zoom', async ({ page }, info) => {
  await page.goto('/')
  await rich(page).pressSequentially('A clear writing space.')
  await menu(page, 'View', /^Settings/)
  await page.getByRole('combobox', { name: 'App theme' }).selectOption('dark')
  await page.getByRole('combobox', { name: 'Editor font' }).selectOption('Consolas')
  await page.getByRole('combobox', { name: 'Text size' }).selectOption('20')
  await page.getByRole('checkbox', { name: 'Wrap Markdown source lines' }).uncheck()
  await page.getByRole('checkbox', { name: 'Spell check' }).check()
  await expect(page.getByRole('textbox', { name: 'Session storage' })).toHaveValue('Browser storage (development preview)')
  await screenshot(page, info, 'settings-dark')
  await button(page, 'Done').click()
  await expect(rich(page)).toHaveCSS('font-size', '20px')
  await expect(rich(page)).toHaveAttribute('spellcheck', 'true')
  await menu(page, 'View', /^Markdown source/)
  await expect(source(page)).toHaveClass(/nowrap/)
  await expect(source(page)).toHaveAttribute('spellcheck', 'true')
  await menu(page, 'View', /^Preview/)
  await expect(page.locator('#preview')).toHaveText('A clear writing space.')
  await menu(page, 'View', /^Formatted/)
  await menu(page, 'View', /^Zoom in/)
  await expect(button(page, '110%')).toBeVisible()
  await menu(page, 'View', /^Zoom out/)
  await expect(button(page, '100%')).toBeVisible()
  await page.keyboard.press('Control+=')
  await menu(page, 'View', /^Reset zoom/)
  await expect(button(page, '100%')).toBeVisible()
  await page.keyboard.press('Control+-')
  await button(page, '90%').click()
  await expect(button(page, '100%')).toBeVisible()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('notepad-session'))?.tabs[0].content)).toBe('A clear writing space.')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(rich(page)).toHaveCSS('font-size', '20px')
  for (const theme of ['light', 'dark', 'system']) {
    await page.getByRole('combobox', { name: 'Quick theme' }).selectOption(theme)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  }
  await page.emulateMedia({ colorScheme: 'dark' })
  await screenshot(page, info, 'editor-dark-auto')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 250, 242)')
})

test('narrow window 640x440: menus, toolbar and scrolled settings remain usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 640, height: 440 })
  await page.goto('/')
  await rich(page).pressSequentially('Short note in a narrow window.')
  await screenshot(page, info, 'narrow-editor-light')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(640)
  for (const name of ['File', 'Edit', 'View']) {
    await button(page, name).click()
    const box = await page.getByRole('menu').boundingBox()
    expect(box.x + box.width).toBeLessThanOrEqual(640)
    await page.keyboard.press('Escape')
  }
  await button(page, 'Insert link').click()
  await expect(page.getByRole('textbox', { name: 'Link destination' })).toBeFocused()
  await page.keyboard.press('Escape')
  await button(page, 'Settings').click()
  await page.getByRole('combobox', { name: 'Text size' }).selectOption('24')
  await button(page, 'Done').click()
  await expect(rich(page)).toHaveCSS('font-size', '24px')
  await page.keyboard.press('Control+h')
  await expect(page.getByRole('textbox', { name: 'Find text' })).toBeFocused()
  await screenshot(page, info, 'narrow-replace')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(640)
})

test('keyboard menu navigation: arrow wrap, activate, Escape returns focus to opener', async ({ page }) => {
  await page.goto('/')
  await button(page, 'File').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: /^New tab/ })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('menuitem', { name: /^Exit/ })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: /^New tab/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab')).toHaveCount(2)
  await button(page, 'Edit').click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(button(page, 'Edit')).toBeFocused()
})

test('writing dialogs expose accessible names and restore editor focus after keyboard cancel', async ({ page }, info) => {
  await page.goto('/')
  await rich(page).pressSequentially('Continue writing here')
  await button(page, 'Insert link').click()
  await screenshot(page, info, 'link-dialog-accessibility')
  await expect.soft(page.getByRole('dialog')).toHaveAccessibleName('Insert link', { timeout: 1000 })
  await page.keyboard.press('Escape')
  await expect.soft(rich(page)).toBeFocused({ timeout: 1000 })
  await button(page, 'Insert image').click()
  await expect.soft(page.getByRole('dialog')).toHaveAccessibleName('Insert image', { timeout: 1000 })
  await page.keyboard.press('Escape')
  await expect.soft(rich(page)).toBeFocused({ timeout: 1000 })
  await button(page, 'Settings').click()
  await expect.soft(page.getByRole('dialog')).toHaveAccessibleName('Settings', { timeout: 1000 })
  // Native HTML dialog must keep keyboard tab navigation inside its controls.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement === document.body || document.querySelector('#modal').contains(document.activeElement)), 'Tab may reach browser chrome, never background application controls').toBe(true)
  }
  await page.keyboard.press('Escape')
})

test('find keyboard dismissal: Escape closes find without losing source text', async ({ page }) => {
  await page.goto('/')
  await writeSource(page, 'Find this private fixture, not a real user note.')
  await page.keyboard.press('Control+f')
  await page.getByRole('textbox', { name: 'Find text' }).fill('fixture')
  await page.keyboard.press('Escape')
  await expect(page.locator('#find-bar')).toBeHidden()
  await expect(source(page)).toHaveValue('Find this private fixture, not a real user note.')
  await expect(source(page)).toBeFocused()
})
