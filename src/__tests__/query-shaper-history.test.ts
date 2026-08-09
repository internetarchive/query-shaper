import { afterEach, describe, expect, it } from 'vitest'
import { mount } from './test-helpers.js'

describe('QueryShaper History', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
  })

  it('records an accepted fill suggestion, with its originating Search Text, to localStorage under the Target id', () => {
    const { shaper, input } = mount()
    input.value = 'climat chnge'

    shaper.accept('climate change')

    const stored = JSON.parse(localStorage.getItem('query-shaper:history:search') ?? '[]')
    expect(stored).toEqual([
      { searchText: 'climat chnge', suggestion: 'climate change', timestamp: expect.any(Number) },
    ])
  })

  it('partitions by history-key when set, instead of the Target id', () => {
    const { shaper, input } = mount()
    shaper.setAttribute('history-key', 'shared-bucket')
    input.value = 'climat chnge'

    shaper.accept('climate change')

    expect(localStorage.getItem('query-shaper:history:search')).toBeNull()
    const stored = JSON.parse(localStorage.getItem('query-shaper:history:shared-bucket') ?? '[]')
    expect(stored).toEqual([
      { searchText: 'climat chnge', suggestion: 'climate change', timestamp: expect.any(Number) },
    ])
  })

  it('recycles the oldest entry once max-history is reached', () => {
    const { shaper, input } = mount()
    shaper.setAttribute('max-history', '2')

    input.value = 'one search'
    shaper.accept('one')
    input.value = 'two search'
    shaper.accept('two')
    input.value = 'three search'
    shaper.accept('three')

    const stored = JSON.parse(localStorage.getItem('query-shaper:history:search') ?? '[]')
    expect(stored).toEqual([
      { searchText: 'two search', suggestion: 'two', timestamp: expect.any(Number) },
      { searchText: 'three search', suggestion: 'three', timestamp: expect.any(Number) },
    ])
  })

  it('clears existing entries and stops recording once max-history is set to 0', () => {
    const { shaper } = mount()
    shaper.accept('one')
    expect(localStorage.getItem('query-shaper:history:search')).not.toBeNull()

    shaper.setAttribute('max-history', '0')
    shaper.accept('two')

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
    expect(stored).toEqual([
      {
        searchText: 'manually typed query',
        suggestion: 'manually typed query',
        timestamp: expect.any(Number),
      },
    ])
  })

  it('records exactly one entry when Accept triggers action=submit (no double-count), preserving the original Search Text', () => {
    const { shaper, input } = mount()
    const form = document.createElement('form')
    form.appendChild(input)
    document.body.appendChild(form)
    form.addEventListener('submit', (e) => e.preventDefault())
    shaper.setAttribute('action', 'submit')
    input.value = 'climat chnge'

    shaper.accept('climate change')

    const stored = JSON.parse(localStorage.getItem('query-shaper:history:search') ?? '[]')
    expect(stored).toEqual([
      { searchText: 'climat chnge', suggestion: 'climate change', timestamp: expect.any(Number) },
    ])
  })
})
