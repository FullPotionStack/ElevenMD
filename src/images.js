// Keep logical Markdown paths in the editor model; only the image DOM uses resolved URLs.
export async function loadImage(img, message, source, doc, { api, prefs }) {
  img.removeAttribute('src'); img.hidden = true
  message.hidden = false; message.textContent = 'Loading image…'
  const token = Symbol(); img.loadToken = token
  const failed = text => { img.hidden = true; message.hidden = false; message.textContent = text }
  try {
    let resolved
    if (/^https:\/\//i.test(source)) {
      if (!prefs.remoteImages) return failed('Remote images blocked · enable “Load remote images” in Settings')
      resolved = source
    } else if (/^data:image\/(?:png|jpeg|gif|webp|bmp|avif);base64,/i.test(source)) {
      resolved = source
    } else {
      if (/^[a-z][a-z\d+.-]*:/i.test(source)) throw new Error('Unsupported image URL. Use HTTPS or a relative local image.')
      if (!doc?.path || !api?.resolveImage) return failed('Local image unavailable · save/open this Markdown file in the desktop app')
      resolved = (await api.resolveImage({ id: doc.id, source })).src
      if (!/^data:image\/(?:png|jpeg|gif|webp|bmp|avif);base64,/i.test(resolved)) throw new Error('Unsupported local image format.')
    }
    if (img.loadToken !== token) return
    if (resolved.length > 28 * 1024 * 1024) throw new Error('Image is too large.')
    img.onload = () => { img.hidden = false; message.hidden = true }
    img.onerror = () => failed(`Image could not load${img.alt ? `: ${img.alt}` : ''}`)
    img.src = resolved
  } catch (error) { if (img.loadToken === token) failed(error.message) }
}

export function imageNode(Image, context) {
  return Image.extend({
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('div'); dom.className = 'markdown-image'; dom.contentEditable = 'false'
        const img = document.createElement('img'), message = document.createElement('span')
        message.className = 'image-message'; dom.append(img, message)
        let displayedDocument
        const display = value => {
          displayedDocument = context.getDocument()?.id
          dom.dataset.source = value.attrs.src || ''
          img.alt = value.attrs.alt || ''; img.title = value.attrs.title || ''
          loadImage(img, message, value.attrs.src || '', context.getDocument(), { api: context.api, prefs: context.getPreferences() })
        }
        display(node)
        return {
          dom,
          update(next) {
            if (next.type !== node.type) return false
            if (JSON.stringify(next.attrs) !== JSON.stringify(node.attrs) || displayedDocument !== context.getDocument()?.id) display(next)
            node = next; return true
          },
        }
      }
    },
  }).configure({ allowBase64: true })
}

export function previewImages(container, doc, context) {
  for (const img of container.querySelectorAll('img')) {
    const source = img.getAttribute('src') || ''
    const dom = document.createElement('div'); dom.className = 'markdown-image'; dom.dataset.source = source
    const message = document.createElement('span'); message.className = 'image-message'
    img.replaceWith(dom); dom.append(img, message)
    loadImage(img, message, source, doc, context)
  }
}
