import { test, expect } from '@playwright/test'

async function render(page, markdown) {
  // Keep parent-shell HMR edits/optimizer reloads from interrupting module-only checks.
  await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: 'export {}' }))
  await page.goto('/')
  await page.evaluate(async source => {
    const { renderMarkdown } = await import('/src/markdown-preview.js')
    window.previewSource = source
    const html = renderMarkdown(source)
    if (typeof html !== 'string') throw new Error('Preview must return an HTML string')
    window.previewFixture = document.createElement('div')
    window.previewFixture.innerHTML = html
  }, markdown)
}

test('renders CommonMark structure and GFM-style inline text', async ({ page }) => {
  await render(page, '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\nSetext one\n===\n\nSetext two\n---\n\n*em* **strong** ~~gone~~ `code` \\*literal\\*\n\n> quote\n\n1. outer\n   - nested\n\n---\n\nline  \nbreak\n\nhttps://example.com\n\n[Reference][ref]\n\n[ref]: https://example.com/ref "Reference title"')
  const result = await page.evaluate(() => {
    const d = window.previewFixture
    return {
      headings: [...d.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => h.tagName),
      emphasis: d.querySelector('em')?.textContent,
      strong: d.querySelector('strong')?.textContent,
      strike: d.querySelector('s')?.textContent,
      inlineCode: d.querySelector('code')?.textContent,
      escaped: d.textContent.includes('*literal*'),
      nested: d.querySelector('ol > li > ul > li')?.textContent.trim(),
      quote: d.querySelector('blockquote')?.textContent.trim(),
      hr: d.querySelectorAll('hr').length,
      breaks: d.querySelectorAll('br').length,
      links: [...d.querySelectorAll('a')].map(a => a.getAttribute('href')),
    }
  })
  expect(result).toEqual({ headings: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H1', 'H2'], emphasis: 'em', strong: 'strong', strike: 'gone', inlineCode: 'code', escaped: true, nested: 'nested', quote: 'quote', hr: 1, breaks: 1, links: ['https://example.com', 'https://example.com/ref'] })
})

test('renders extended lists, tables, notes, and highlighted fences', async ({ page }) => {
  await render(page, '- [x] done\n- [ ] pending\n\n| Name | Value |\n| --- | --- |\n| item | **bold** |\n\nTerm\n: A definition\n\nA note[^n] and inline^[Short note].\n\n[^n]: Footnote body.\n\n```javascript\nconst answer = 42;\n```\n\n```not-a-language\n<script>alert(1)</script>\n```')
  const result = await page.evaluate(() => {
    const d = window.previewFixture
    return {
      tasks: [...d.querySelectorAll('input')].map(i => ({ type: i.type, disabled: i.disabled, checked: i.checked })),
      table: d.querySelector('tbody td strong')?.textContent,
      term: d.querySelector('dt')?.textContent,
      definition: d.querySelector('dd')?.textContent.trim(),
      notes: d.querySelectorAll('.footnote-item').length,
      notesWork: [...d.querySelectorAll('.footnote-ref a, .footnote-backref')].every(a => d.querySelector(a.getAttribute('href'))),
      highlighted: Boolean(d.querySelector('pre code .hljs-keyword')),
      code: [...d.querySelectorAll('pre code')].map(c => c.textContent),
      scripts: d.querySelectorAll('script').length,
    }
  })
  expect(result).toEqual({ tasks: [{ type: 'checkbox', disabled: true, checked: true }, { type: 'checkbox', disabled: true, checked: false }], table: 'bold', term: 'Term', definition: 'A definition', notes: 2, notesWork: true, highlighted: true, code: ['const answer = 42;\n', '<script>alert(1)</script>\n'], scripts: 0 })
})

test('renders inline and display math without enabling TeX HTML capabilities', async ({ page }) => {
  await render(page, 'Inline $x^2 + \\frac{1}{2}$.\n\n$$\n\\sum_{i=1}^{n} i\n$$\n\n$\\href{javascript:alert(1)}{evil}$\n\n$\\htmlData{hermes=evil}{bad}$\n\n$\\notARealCommand$')
  const result = await page.evaluate(() => {
    const d = window.previewFixture
    return {
      math: d.querySelectorAll('math').length,
      fraction: Boolean(d.querySelector('mfrac')),
      superscript: Boolean(d.querySelector('msup')),
      display: Boolean(d.querySelector('math[display="block"]')),
      errorShown: d.textContent.includes('notARealCommand'),
      unsafeLink: Boolean(d.querySelector('a[href^="javascript:"]')),
      injected: Boolean(d.querySelector('[data-hermes]')),
    }
  })
  expect(result.math).toBeGreaterThanOrEqual(4)
  expect(result).toMatchObject({ fraction: true, superscript: true, display: true, errorShown: true, unsafeLink: false, injected: false })
})

test('sanitizes hostile HTML and URLs while retaining a display-only safe subset', async ({ page }) => {
  await render(page, '<script>window.previewXSS = true</script>\n<style>body{display:none}</style>\n<iframe src="https://example.com"></iframe>\n<svg><foreignObject><p onclick="window.previewXSS=true">bad</p></foreignObject></svg>\n<math><mtext><img src="x" onerror="window.previewXSS=true"></mtext></math>\n<div data-hermes="save" data-custom="evil" style="color:red" onclick="window.previewXSS=true"><strong>Safe bold</strong></div>\n<a href="jav&#x61;script:alert(1)">bad link</a>\n<a href="javascript:alert(1)">bad link two</a>\n<img src="javascript:alert(1)" onerror="window.previewXSS=true">\n<img src="data:image/svg+xml,%3Csvg%20onload=alert(1)%3E">\n<form><input type="text"><button>submit</button></form>\n<input type="checkbox" checked onclick="window.previewXSS=true">\n<details><summary>More</summary><mark>Safe detail</mark></details>\n\n[bad](javascript:alert(1))')
  const result = await page.evaluate(() => {
    const d = window.previewFixture
    for (const image of d.querySelectorAll('img')) image.dispatchEvent(new Event('error'))
    return {
      forbidden: [...d.querySelectorAll('script,style,iframe,svg,foreignObject,form,button,object,embed')].map(e => e.tagName),
      unsafeAttrs: [...d.querySelectorAll('*')].flatMap(e => [...e.attributes].filter(a => /^on|^data-|^style$/i.test(a.name)).map(a => a.name)),
      unsafeURLs: [...d.querySelectorAll('[src],[href]')].flatMap(e => ['src', 'href'].map(a => e.getAttribute(a)).filter(v => v && /^(?:javascript|vbscript|data):/i.test(v))),
      inputs: [...d.querySelectorAll('input')].map(i => ({ type: i.type, disabled: i.disabled })),
      bold: d.querySelector('strong')?.textContent,
      details: d.querySelector('details summary')?.textContent,
      marked: d.querySelector('mark')?.textContent,
      xss: window.previewXSS === true,
    }
  })
  expect(result).toEqual({ forbidden: [], unsafeAttrs: [], unsafeURLs: [], inputs: [{ type: 'checkbox', disabled: true }], bold: 'Safe bold', details: 'More', marked: 'Safe detail', xss: false })
})

test('preserves metadata, logical image references, and untouched source comments', async ({ page }) => {
  const metadata = '---\r\ntitle: "<img src=x onerror=alert(1)>"\r\ncustom: true\r\n---\r\n'
  const source = metadata + '\r\n# Body\r\n\r\n<!-- PRIVATE original comment -->\r\n\r\n![Remote](https://example.com/image.png)\r\n![Local](./assets/image.png)\r\n![Ref][image]\r\n![Absolute](file:///C:/notes/image.png)\r\n\r\n[image]: ../media/photo.png "Photo"\r\n'
  await render(page, source)
  const result = await page.evaluate(async original => {
    const { renderMarkdown } = await import('/src/markdown-preview.js')
    const d = window.previewFixture
    const toml = document.createElement('div')
    toml.innerHTML = renderMarkdown('+++\ntitle = "TOML"\n+++\n\nBody')
    const empty = renderMarkdown('')
    return {
      metadata: d.querySelector('details pre code')?.textContent,
      collapsed: d.querySelector('details')?.open,
      heading: d.querySelector('h1')?.textContent,
      images: [...d.querySelectorAll('img')].map(i => i.getAttribute('src')),
      commentInPreview: d.innerHTML.includes('PRIVATE original comment'),
      sourceUnchanged: window.previewSource === original && window.previewSource.includes('<!-- PRIVATE original comment -->'),
      repeat: renderMarkdown(original) === d.innerHTML,
      toml: toml.querySelector('details pre code')?.textContent,
      empty,
    }
  }, source)
  expect(result).toEqual({ metadata: metadata.replace(/\r\n/g, '\n'), collapsed: false, heading: 'Body', images: ['https://example.com/image.png', './assets/image.png', '../media/photo.png', 'file:///C:/notes/image.png'], commentInPreview: false, sourceUnchanged: true, repeat: true, toml: '+++\ntitle = "TOML"\n+++\n', empty: '' })
})

test('recognizes front matter only at the document start', async ({ page }) => {
  await render(page, '+++\ntitle = "TOML first"\n+++\n\n# Body\n\n---\nLater text\n---\n')
  const result = await page.evaluate(async () => {
    const { renderMarkdown } = await import('/src/markdown-preview.js')
    const middle = document.createElement('div')
    middle.innerHTML = renderMarkdown('# Start\n\n---\nLater text\n---\n')
    const unclosed = document.createElement('div')
    unclosed.innerHTML = renderMarkdown('---\ntitle: Unclosed\n')
    return {
      metadata: window.previewFixture.querySelector('details code')?.textContent,
      body: window.previewFixture.querySelector('h1')?.textContent,
      laterPreserved: window.previewFixture.textContent.includes('Later text'),
      middleMetadata: middle.querySelectorAll('.markdown-metadata').length,
      unclosedPreserved: unclosed.textContent.includes('title: Unclosed'),
    }
  })
  expect(result).toEqual({ metadata: '+++\ntitle = "TOML first"\n+++\n', body: 'Body', laterPreserved: true, middleMetadata: 0, unclosedPreserved: true })
})
