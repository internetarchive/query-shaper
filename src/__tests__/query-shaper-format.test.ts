import { afterEach, describe, expect, it } from 'vitest'
import { QueryShaper } from '../query-shaper.js'

describe('QueryShaper Format', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('resolves the lucene preset from the format attribute', () => {
    const shaper = new QueryShaper()
    shaper.setAttribute('format', 'lucene')
    document.body.appendChild(shaper)

    expect(shaper.format).toBe('lucene')
  })

  it('resolves the url-params preset from the format attribute', () => {
    const shaper = new QueryShaper()
    shaper.setAttribute('format', 'url-params')
    document.body.appendChild(shaper)

    expect(shaper.format).toBe('url-params')
  })

  it('defaults to lucene when the format attribute is absent', () => {
    const shaper = new QueryShaper()
    document.body.appendChild(shaper)

    expect(shaper.format).toBe('lucene')
  })

  it('lets the imperative property override the attribute with a custom render function', () => {
    const shaper = new QueryShaper()
    shaper.setAttribute('format', 'lucene')
    document.body.appendChild(shaper)

    const customRenderer = (fields: { field: string; value: string }[]) =>
      fields.map((f) => `${f.field}=${f.value}`).join('&')
    shaper.format = customRenderer

    expect(shaper.format).toBe(customRenderer)
  })
})
