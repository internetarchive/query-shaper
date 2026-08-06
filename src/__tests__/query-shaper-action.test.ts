import { afterEach, describe, expect, it } from 'vitest'
import { mount } from './test-helpers.js'

describe('QueryShaper Action', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
  })

  it('fills the Target with the suggestion text by default', () => {
    const { shaper, input } = mount()

    shaper.accept({ kind: 'correction', text: 'climate change' })

    expect(input.value).toBe('climate change')
  })

  it('fills and submits the Target\'s form when action is submit', () => {
    const { shaper, input } = mount()
    const form = document.createElement('form')
    form.appendChild(input)
    document.body.appendChild(form)
    shaper.setAttribute('action', 'submit')

    let submitted = false
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      submitted = true
    })

    shaper.accept({ kind: 'correction', text: 'climate change' })

    expect(input.value).toBe('climate change')
    expect(submitted).toBe(true)
  })

  it('records History directly when action is submit but the Target has no form', () => {
    const { shaper, input } = mount()
    shaper.setAttribute('action', 'submit')
    // deliberately no <form> ancestor for the Target

    shaper.accept({ kind: 'correction', text: 'climate change' })

    expect(input.value).toBe('climate change')
    const stored = JSON.parse(localStorage.getItem('query-shaper:history:search') ?? '[]')
    expect(stored).toEqual(['climate change'])
  })

  it('computes the OpenSearch URL from the template when action is opensearch', () => {
    const { shaper } = mount()
    shaper.setAttribute('action', 'opensearch')
    shaper.setAttribute('template', 'https://example.com/search/{searchTerms}')

    let detail: { url?: string } = {}
    shaper.addEventListener('query-shaper-accept', (e) => {
      detail = (e as CustomEvent).detail
    })

    shaper.accept({ kind: 'correction', text: 'climate change' })

    expect(detail.url).toBe('https://example.com/search/climate%20change')
  })

  it('substitutes the searchTerms placeholder even inside a URL path segment', () => {
    const { shaper } = mount()
    shaper.setAttribute('action', 'opensearch')
    shaper.setAttribute('template', 'https://web.archive.org/collection-search/gov/{searchTerms}')

    let detail: { url?: string } = {}
    shaper.addEventListener('query-shaper-accept', (e) => {
      detail = (e as CustomEvent).detail
    })

    shaper.accept({
      kind: 'expression',
      text: 'book language:en',
      fields: [{ field: 'language', value: 'en' }],
    })

    expect(detail.url).toBe('https://web.archive.org/collection-search/gov/book%20language%3Aen')
  })

  it('does not touch the Target when action is none, but still emits accept and records History', () => {
    const { shaper, input } = mount()
    shaper.setAttribute('action', 'none')

    let acceptDetail: unknown
    shaper.addEventListener('query-shaper-accept', (e) => {
      acceptDetail = (e as CustomEvent).detail
    })

    shaper.accept({ kind: 'correction', text: 'climate change' })

    expect(input.value).toBe('')
    expect(acceptDetail).toEqual({ suggestion: { kind: 'correction', text: 'climate change' }, action: 'none', url: undefined })
    const stored = JSON.parse(localStorage.getItem('query-shaper:history:search') ?? '[]')
    expect(stored).toEqual(['climate change'])
  })

  it('fills the Target and writes to a textarea destination via .value', () => {
    const { shaper, input } = mount()
    const textarea = document.createElement('textarea')
    textarea.id = 'result'
    document.body.appendChild(textarea)
    shaper.setAttribute('action', 'output')
    shaper.setAttribute('destination', '#result')

    shaper.accept({ kind: 'correction', text: 'SELECT * FROM books' })

    expect(input.value).toBe('SELECT * FROM books')
    expect(textarea.value).toBe('SELECT * FROM books')
  })

  it('writes to a non-form destination via .textContent', () => {
    const { shaper } = mount()
    const pre = document.createElement('pre')
    pre.id = 'preview'
    document.body.appendChild(pre)
    shaper.setAttribute('action', 'output')
    shaper.setAttribute('destination', '#preview')

    shaper.accept({ kind: 'correction', text: 'SELECT * FROM books' })

    expect(pre.textContent).toBe('SELECT * FROM books')
  })

  it('writes to every element matched by the destination selector', () => {
    const { shaper } = mount()
    const a = document.createElement('div')
    a.className = 'preview'
    const b = document.createElement('div')
    b.className = 'preview'
    document.body.appendChild(a)
    document.body.appendChild(b)
    shaper.setAttribute('action', 'output')
    shaper.setAttribute('destination', '.preview')

    shaper.accept({ kind: 'correction', text: 'SELECT * FROM books' })

    expect(a.textContent).toBe('SELECT * FROM books')
    expect(b.textContent).toBe('SELECT * FROM books')
  })

  it('does not throw when destination matches nothing', () => {
    const { shaper } = mount()
    shaper.setAttribute('action', 'output')
    shaper.setAttribute('destination', '#does-not-exist')

    expect(() => shaper.accept({ kind: 'correction', text: 'SELECT * FROM books' })).not.toThrow()
  })

  it('falls back to an internal <output> element when destination is absent', () => {
    const { shaper } = mount()
    shaper.setAttribute('action', 'output')

    shaper.accept({ kind: 'correction', text: 'SELECT * FROM books' })

    const output = shaper.shadowRoot?.querySelector('output')
    expect(output?.textContent).toBe('SELECT * FROM books')
  })
})
