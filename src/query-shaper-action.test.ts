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
      kind: 'structured-query',
      text: 'book language:en',
      fields: [{ field: 'language', value: 'en' }],
    })

    expect(detail.url).toBe('https://web.archive.org/collection-search/gov/book%20language%3Aen')
  })
})
