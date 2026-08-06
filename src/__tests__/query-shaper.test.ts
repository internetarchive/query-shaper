import { describe, expect, it } from 'vitest'
import { QueryShaper } from '../query-shaper.js'

describe('QueryShaper', () => {
  it('registers itself as <query-shaper>', () => {
    expect(customElements.get('query-shaper')).toBe(QueryShaper)
  })

  it('resolves its Target via the for attribute', () => {
    const input = document.createElement('input')
    input.id = 'search'
    document.body.appendChild(input)

    const shaper = new QueryShaper()
    shaper.setAttribute('for', 'search')
    document.body.appendChild(shaper)

    expect(shaper.target).toBeInstanceOf(HTMLInputElement)
    expect(shaper.target?.id).toBe('search')
  })

  it('sets autocomplete off on the Target once connected', () => {
    const input = document.createElement('input')
    input.id = 'search2'
    document.body.appendChild(input)

    const shaper = new QueryShaper()
    shaper.setAttribute('for', 'search2')
    document.body.appendChild(shaper)

    expect(input.getAttribute('autocomplete')).toBe('off')
  })
})
