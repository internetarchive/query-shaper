import { afterEach, describe, expect, it } from 'vitest'
import { mount } from './test-helpers.js'

describe('QueryShaper History', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
  })

  it('records an accepted fill suggestion to localStorage under the Target id', () => {
    const { shaper } = mount()

    shaper.accept({ kind: 'correction', text: 'climate change' })

    const stored = JSON.parse(localStorage.getItem('query-shaper:history:search') ?? '[]')
    expect(stored).toEqual(['climate change'])
  })

  it('partitions by history-key when set, instead of the Target id', () => {
    const { shaper } = mount()
    shaper.setAttribute('history-key', 'shared-bucket')

    shaper.accept({ kind: 'correction', text: 'climate change' })

    expect(localStorage.getItem('query-shaper:history:search')).toBeNull()
    const stored = JSON.parse(localStorage.getItem('query-shaper:history:shared-bucket') ?? '[]')
    expect(stored).toEqual(['climate change'])
  })

  it('recycles the oldest entry once max-history is reached', () => {
    const { shaper } = mount()
    shaper.setAttribute('max-history', '2')

    shaper.accept({ kind: 'correction', text: 'one' })
    shaper.accept({ kind: 'correction', text: 'two' })
    shaper.accept({ kind: 'correction', text: 'three' })

    const stored = JSON.parse(localStorage.getItem('query-shaper:history:search') ?? '[]')
    expect(stored).toEqual(['two', 'three'])
  })

  it('clears existing entries and stops recording once max-history is set to 0', () => {
    const { shaper } = mount()
    shaper.accept({ kind: 'correction', text: 'one' })
    expect(localStorage.getItem('query-shaper:history:search')).not.toBeNull()

    shaper.setAttribute('max-history', '0')
    shaper.accept({ kind: 'correction', text: 'two' })

    expect(localStorage.getItem('query-shaper:history:search')).toBeNull()
  })

  it('records the current Search Text when the Target form is submitted natively', () => {
    const { input } = mount()
    const form = document.createElement('form')
    form.appendChild(input)
    document.body.appendChild(form)
    form.addEventListener('submit', (e) => e.preventDefault())

    input.value = 'manually typed query'
    form.requestSubmit()

    const stored = JSON.parse(localStorage.getItem('query-shaper:history:search') ?? '[]')
    expect(stored).toEqual(['manually typed query'])
  })

  it('records exactly one entry when Accept triggers action=submit (no double-count)', () => {
    const { shaper, input } = mount()
    const form = document.createElement('form')
    form.appendChild(input)
    document.body.appendChild(form)
    form.addEventListener('submit', (e) => e.preventDefault())
    shaper.setAttribute('action', 'submit')

    shaper.accept({ kind: 'correction', text: 'climate change' })

    const stored = JSON.parse(localStorage.getItem('query-shaper:history:search') ?? '[]')
    expect(stored).toEqual(['climate change'])
  })
})
