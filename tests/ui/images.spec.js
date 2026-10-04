import { test, expect } from '@playwright/test'
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII='
const original = '# Picture\n\n![A small image](assets/pixel.png)\n'
test('local images display without replacing relative Markdown paths with data URLs', async ({ page }) => {
  await page.addInitScript(({ png, original }) => {
    window.notepad = {
      initialFiles: async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'picture.md', path: 'C:/docs/picture.md', content: original }],
      setDirty: () => {}, onAction: () => {}, preferences: async () => {},
      resolveImage: async request => { window.lastImageRequest = request; return { src: png, mime: 'image/png' } },
      importImage: async () => ({ source: 'picture.assets/copied.png' }),
    }
  }, { png, original })
  await page.goto('/')
  const img = page.locator('.tiptap img')
  await expect(img).toHaveAttribute('alt', 'A small image')
  await expect.poll(() => img.evaluate(el => el.naturalWidth)).toBe(1)
  expect(await page.evaluate(() => window.lastImageRequest.source)).toBe('assets/pixel.png')
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue(original)
  await page.getByRole('button', { name: 'Formatted', exact: true }).click()
  await page.getByRole('button', { name: 'Insert image', exact: true }).click()
  await page.getByRole('textbox', { name: 'Image alt text', exact: true }).fill('Copied image')
  await page.getByRole('button', { name: 'Choose local image…', exact: true }).click()
  await expect(page.locator('.tiptap img[alt="Copied image"]')).toBeVisible()
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  const content = await page.getByRole('textbox', { name: 'Markdown source' }).inputValue()
  expect(content).toContain('![Copied image](picture.assets/copied.png)')
  expect(content).not.toContain('data:image')
})

test('formatted toolbar exposes all heading levels, rules, links and image URLs', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Block style' }).selectOption('h6')
  await page.locator('.tiptap').pressSequentially('Small heading')
  await expect(page.locator('.tiptap h6')).toHaveText('Small heading')
  await page.locator('.tiptap').press('ArrowRight')
  await page.getByRole('button', { name: 'Horizontal rule', exact: true }).click()
  await expect(page.locator('.tiptap hr')).toBeVisible()
  await page.getByRole('button', { name: 'Insert link', exact: true }).click()
  await page.getByRole('textbox', { name: 'Link text', exact: true }).fill('Example')
  await page.getByRole('textbox', { name: 'Link destination', exact: true }).fill('https://example.com')
  await page.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(page.locator('.tiptap a[href="https://example.com"]')).toHaveText('Example')
  await page.getByRole('button', { name: 'Insert image', exact: true }).click()
  await page.getByRole('textbox', { name: 'Image URL', exact: true }).fill('https://example.com/photo.png')
  await page.getByRole('textbox', { name: 'Image alt text', exact: true }).fill('Remote image')
  await page.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(page.getByText('Remote images blocked', { exact: false })).toBeVisible()
})
