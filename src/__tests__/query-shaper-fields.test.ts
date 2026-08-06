import { afterEach, describe, expect, it } from 'vitest'
import { QueryShaper } from '../query-shaper.js'

describe('QueryShaper Fields', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('parses a JSON array fields attribute into a structured array', () => {
    const shaper = new QueryShaper()
    shaper.setAttribute('fields', '[{"name":"title"}]')
    document.body.appendChild(shaper)

    expect(shaper.fields).toEqual([{ name: 'title' }])
  })

  it('falls back to the raw string when the fields attribute is not valid JSON', () => {
    const shaper = new QueryShaper()
    shaper.setAttribute('fields', 'title, author, language:iso-639-1')
    document.body.appendChild(shaper)

    expect(shaper.fields).toBe('title, author, language:iso-639-1')
  })

  it('has no Fields when neither the attribute nor the property is set', () => {
    const shaper = new QueryShaper()
    document.body.appendChild(shaper)

    expect(shaper.fields).toBeUndefined()
  })

  it('lets the imperative property override the attribute', () => {
    const shaper = new QueryShaper()
    shaper.setAttribute('fields', '[{"name":"title"}]')
    document.body.appendChild(shaper)

    shaper.fields = [{ name: 'author' }]

    expect(shaper.fields).toEqual([{ name: 'author' }])
  })
})
