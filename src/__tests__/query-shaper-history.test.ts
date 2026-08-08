import { afterEach, describe, expect, it } from 'vitest'
import { mount } from './test-helpers.js'

describe('QueryShaper History', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
  })

  it('records an accepted fill suggestion, with its kind and originating Search Text, to localStorage under the Target id', () => {
    const { shaper, input } = mount()
    input.value = 'climat chnge'

    shaper.accept({ kind: 'correction', text: 'climate change' })

    const stored = JSON.parse(localStorage.getItem('query-shaper:history:search') ?? '[]')
    expect(stored).toEqual([
      { searchText: 'climat chnge', suggestion: 'climate change', kind: 'correction', timestamp: expect.any(Number) },
    ])
  })

  it('partitions by history-key when set, instead of the Target id', () => {
    const { shaper, input } = mount()
    shaper.setAttribute('history-key', 'shared-bucket')
    input.value = 'climat chnge'

    shaper.accept({ kind: 'correction', text: 'climate change' })

    expect(localStorage.getItem('query-shaper:history:search')).toBeNull()
    const stored = JSON.parse(localStorage.getItem('query-shaper:history:shared-bucket') ?? '[]')
    expect(stored).toEqual([
      { searchText: 'climat chnge', suggestion: 'climate change', kind: 'correction', timestamp: expect.any(Number) },
    ])
  })

  it('recycles the oldest entry once max-history is reached', () => {
    const { shaper, input } = mount()
    shaper.setAttribute('max-history', '2')

    input.value = 'one search'
    shaper.accept({ kind: 'correction', text: 'one' })
    input.value = 'two search'
    shaper.accept({ kind: 'correction', text: 'two' })
    input.value = 'three search'
    shaper.accept({ kind: 'correction', text: 'three' })

    const stored = JSON.parse(localStorage.getItem('query-shaper:history:search') ?? '[]')
    expect(stored).toEqual([
      { searchText: 'two search', suggestion: 'two', kind: 'correction', timestamp: expect.any(Number) },
      { searchText: 'three search', suggestion: 'three', kind: 'correction', timestamp: expect.any(Number) },
    ])
  })

  it('clears existing entries and stops recording once max-history is set to 0', () => {
    const { shaper } = mount()
    shaper.accept({ kind: 'correction', text: 'one' })
    expect(localStorage.getItem('query-shaper:history:search')).not.toBeNull()

    shaper.setAttribute('max-history', '0')
    shaper.accept({ kind: 'correction', text: 'two' })

    expect(localStorage.getItem('query-shaper:history:search')).toBeNull()
  })

  it('records the current Search Text when the Target form is submitted natively, with kind "submit"', () => {
    const { input } = mount()
    const form = document.createElement('form')
    form.appendChild(input)
    document.body.appendChild(form)
    form.addEventListener('submit', (e) => e.preventDefault())

    input.value = 'manually typed query'
    form.requestSubmit()

    const stored = JSON.parse(localStorage.getItem('query-shaper:history:search') ?? '[]')
    expect(stored).toEqual([
      {
        searchText: 'manually typed query',
        suggestion: 'manually typed query',
        kind: 'submit',
        timestamp: expect.any(Number),
      },
    ])
  })

  it('records exactly one entry when Accept triggers action=submit (no double-count), preserving the original Search Text and kind', () => {
    const { shaper, input } = mount()
    const form = document.createElement('form')
    form.appendChild(input)
    document.body.appendChild(form)
    form.addEventListener('submit', (e) => e.preventDefault())
    shaper.setAttribute('action', 'submit')
    input.value = 'climat chnge'

    shaper.accept({ kind: 'correction', text: 'climate change' })

    const stored = JSON.parse(localStorage.getItem('query-shaper:history:search') ?? '[]')
    expect(stored).toEqual([
      { searchText: 'climat chnge', suggestion: 'climate change', kind: 'correction', timestamp: expect.any(Number) },
    ])
  })
})
