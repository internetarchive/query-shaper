import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetSharedSessionForTests } from '../query-shaper.js'
import { mockLanguageModel, mount } from './test-helpers.js'

describe('QueryShaper generation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    __resetSharedSessionForTests()
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel
    document.body.innerHTML = ''
    localStorage.clear()
  })

  it('generates suggestions from a debounced input and emits them', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          { kind: 'correction', text: 'climate change' },
          { kind: 'expansion', text: 'global warming' },
        ],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'climat change'
    input.dispatchEvent(new Event('input'))

    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual([
      { kind: 'correction', text: 'climate change' },
      { kind: 'expansion', text: 'global warming' },
    ])
  })

  it('debounces rapid keystrokes into a single generation call', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    input.value = 'c'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(100)
    input.value = 'cl'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(100)
    input.value = 'cli'
    input.dispatchEvent(new Event('input'))

    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))
    const [promptText] = lm.clonedSession.prompt.mock.calls[0] as [string, unknown]
    expect(promptText).toContain('cli')
  })

  it('renders an expression suggestion using the configured lucene format', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          {
            kind: 'expression',
            fields: [
              { field: 'title', value: '"climate change"' },
              { field: 'year', value: '2020', operator: 'AND' },
            ],
          },
        ],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"title"},{"name":"year"}]')
    shaper.setAttribute('format', 'lucene')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'climate change 2020'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual([
      {
        kind: 'expression',
        text: 'title:"climate change" AND year:2020',
        fields: [
          { field: 'title', value: '"climate change"' },
          { field: 'year', value: '2020', operator: 'AND' },
        ],
      },
    ])
  })

  it('renders bare, unscoped terms alongside field-scoped ones in the lucene format', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          {
            kind: 'expression',
            fields: [
              { value: 'climate' },
              { value: 'change' },
              { field: 'year', value: '2020', operator: 'AND' },
            ],
          },
        ],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"year"}]')
    shaper.setAttribute('format', 'lucene')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'climate change 2020'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect((suggestionEvents[0] as Array<{ text: string }>).at(0)?.text).toBe('climate change AND year:2020')
  })

  it('renders an expression suggestion using the simple-query-string format', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          {
            kind: 'expression',
            fields: [
              { value: 'quick', operator: '+' },
              { value: 'fox', operator: '-' },
              { value: '"exact phrase"' },
              { field: 'title', value: 'foo', operator: '+' },
            ],
          },
        ],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"title"}]')
    shaper.setAttribute('format', 'simple-query-string')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'quick fox exact phrase'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect((suggestionEvents[0] as Array<{ text: string }>).at(0)?.text).toBe(
      '+quick -fox "exact phrase" +title:foo',
    )
  })

  it('renders a bare term under a default q key in the url-params format', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          { kind: 'expression', fields: [{ value: 'book' }, { field: 'language', value: 'en' }] },
        ],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"language"}]')
    shaper.setAttribute('format', 'url-params')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'book in english'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect((suggestionEvents[0] as Array<{ text: string }>).at(0)?.text).toBe('q=book&language=en')
  })

  it('drops expression suggestions when no Fields are configured', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          { kind: 'correction', text: 'climate change' },
          { kind: 'expression', fields: [{ field: 'title', value: 'climate change' }] },
        ],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    // no `fields` attribute/property set on shaper

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'climat change'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual([{ kind: 'correction', text: 'climate change' }])
  })

  it('renders an expression suggestion using the url-params format', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          {
            kind: 'expression',
            fields: [
              { field: 'q', value: 'book' },
              { field: 'language', value: 'en' },
            ],
          },
        ],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"q"},{"name":"language"}]')
    shaper.setAttribute('format', 'url-params')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'book in english'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect((suggestionEvents[0] as Array<{ text: string }>).at(0)?.text).toBe('q=book&language=en')
  })

  it('renders an expression suggestion using a custom .format function', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [{ kind: 'expression', fields: [{ field: 'title', value: 'book' }] }],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"title"}]')
    shaper.format = (fields) => fields.map((f) => `CUSTOM(${f.field}=${f.value})`).join(',')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'book'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect((suggestionEvents[0] as Array<{ text: string }>).at(0)?.text).toBe('CUSTOM(title=book)')
  })

  it('caps total suggestions at max-suggestions', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          { kind: 'correction', text: 'a' },
          { kind: 'expansion', text: 'b' },
          { kind: 'expansion', text: 'c' },
        ],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('max-suggestions', '2')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'x'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual([
      { kind: 'correction', text: 'a' },
      { kind: 'expansion', text: 'b' },
    ])
  })

  it('caps each kind at its built-in default before any max-suggestions total cap applies', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          { kind: 'correction', text: 'c1' },
          { kind: 'correction', text: 'c2' },
          { kind: 'expression', fields: [{ field: 'title', value: 's1' }] },
          { kind: 'expansion', text: 'e1' },
          { kind: 'expression', fields: [{ field: 'title', value: 's2' }] },
          { kind: 'expansion', text: 'e2' },
          { kind: 'expression', fields: [{ field: 'title', value: 's3' }] },
          { kind: 'expansion', text: 'e3' },
          { kind: 'expression', fields: [{ field: 'title', value: 's4' }] },
        ],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"title"}]')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'x'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    const suggestions = suggestionEvents[0] as Array<{ kind: string }>
    const countByKind = (kind: string) => suggestions.filter((s) => s.kind === kind).length
    expect(countByKind('correction')).toBe(1)
    expect(countByKind('expansion')).toBe(2)
    expect(countByKind('expression')).toBe(3)
    expect(suggestions).toHaveLength(6)
  })

  it('includes the Fields description in the prompt sent to the model', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', 'title, author, year')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    input.value = 'climate change'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    const [promptText] = lm.clonedSession.prompt.mock.calls[0] as [string, unknown]
    expect(promptText).toContain('title, author, year')
    expect(promptText).toContain('climate change')
  })

  it('includes Format instructions in the prompt when Fields are configured', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', 'title, author, year')
    shaper.setAttribute('format', 'url-params')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    input.value = 'climate change'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    const [promptText] = lm.clonedSession.prompt.mock.calls[0] as [string, unknown]
    expect(promptText).toContain('url-params')
  })

  it('includes prior History entries in the prompt sent to the model', async () => {
    localStorage.setItem('query-shaper:history:search', JSON.stringify(['old search one', 'old search two']))
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    input.value = 'new search'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    const [promptText] = lm.clonedSession.prompt.mock.calls[0] as [string, unknown]
    expect(promptText).toContain('old search one')
    expect(promptText).toContain('old search two')
  })

  it('only feeds up to max-history entries into the prompt, even if more are stored', async () => {
    localStorage.setItem(
      'query-shaper:history:search',
      JSON.stringify(['search one', 'search two', 'search three', 'search four']),
    )
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('max-history', '2')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    input.value = 'new search'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    const [promptText] = lm.clonedSession.prompt.mock.calls[0] as [string, unknown]
    expect(promptText).not.toContain('search one')
    expect(promptText).not.toContain('search two')
    expect(promptText).toContain('search three')
    expect(promptText).toContain('search four')
  })

  it('trims the oldest History entry and retries on context overflow', async () => {
    localStorage.setItem('query-shaper:history:search', JSON.stringify(['old search one', 'old search two']))
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const quotaError = Object.assign(new Error('context window exceeded'), { name: 'QuotaExceededError' })
    lm.clonedSession.prompt
      .mockRejectedValueOnce(quotaError)
      .mockResolvedValueOnce(JSON.stringify({ suggestions: [] }))
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    input.value = 'new search'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(2))

    const [firstCall] = lm.clonedSession.prompt.mock.calls[0] as [string, unknown]
    const [secondCall] = lm.clonedSession.prompt.mock.calls[1] as [string, unknown]
    expect(firstCall).toContain('old search one')
    expect(secondCall).not.toContain('old search one')
    expect(secondCall).toContain('old search two')
  })
})
