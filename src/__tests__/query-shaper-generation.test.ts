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

  it('skips generating again when only leading/trailing whitespace changed', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    input.value = 'climate change'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    input.value = 'climate change '
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)

    expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1)
  })

  it('generates again after the field is cleared and the same text is retyped', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    input.value = 'climate change'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    input.value = ''
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)

    input.value = 'climate change'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(2))
  })

  it('aborts the previous in-flight request when a genuinely new search text is ready', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    input.value = 'first query'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))
    const [, firstOptions] = lm.clonedSession.prompt.mock.calls[0] as [string, { signal: AbortSignal }]
    expect(firstOptions.signal.aborted).toBe(false)

    input.value = 'second different query'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(2))

    expect(firstOptions.signal.aborted).toBe(true)
  })

  it('ignores a stale generation that resolves after a newer one already completed', async () => {
    vi.useRealTimers()
    const lm = mockLanguageModel({ availability: 'available' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    let resolveFirst: (raw: string) => void = () => {}
    const firstPrompt = new Promise<string>((resolve) => {
      resolveFirst = resolve
    })
    lm.clonedSession.prompt
      .mockImplementationOnce(() => firstPrompt)
      .mockImplementationOnce(() =>
        Promise.resolve(JSON.stringify({ suggestions: [{ kind: 'correction', text: 'second, newer result' }] })),
      )

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'first, slower query'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1), { timeout: 1000 })

    input.value = 'second, faster query'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1), { timeout: 1000 })
    expect(suggestionEvents[0]).toEqual([{ kind: 'correction', text: 'second, newer result' }])

    resolveFirst(JSON.stringify({ suggestions: [{ kind: 'correction', text: 'first, STALE result' }] }))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(suggestionEvents).toHaveLength(1)
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

  it('excludes a Correction or Expansion identical to the Search Text, keeping the rest', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          { kind: 'correction', text: 'climate change' },
          { kind: 'expansion', text: 'climate change' },
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

    input.value = 'climate change'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual([{ kind: 'expansion', text: 'global warming' }])
  })

  it('excludes an Expression whose rendered text is identical to the Search Text', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [{ kind: 'expression', fields: [{ value: 'climate change' }] }],
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

    input.value = 'climate change'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual([])
  })

  it('skips the model call and clears suggestions when the Target is cleared', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: [{ kind: 'correction', text: 'climate change' }] },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'climate'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))
    expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1)

    input.value = ''
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(2))

    expect(suggestionEvents[1]).toEqual([])
    expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1)
  })

  it('never calls the model for whitespace-only input', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    input.value = '   '
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)

    expect(lm.clonedSession.prompt).not.toHaveBeenCalled()
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
              { field: 'title', value: 'climate change' },
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
          { field: 'title', value: 'climate change' },
          { field: 'year', value: '2020', operator: 'AND' },
        ],
      },
    ])
  })

  it('does not double-quote a field value the model already quoted itself', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [{ kind: 'expression', fields: [{ field: 'title', value: '"climate change"' }] }],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"title"}]')
    shaper.setAttribute('format', 'lucene')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'climate change'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect((suggestionEvents[0] as Array<{ text: string }>).at(0)?.text).toBe('title:"climate change"')
  })

  it('falls back to the model\'s raw text when it omits fields for a lucene/simple-query-string/url-params Expression', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [{ kind: 'expression', text: 'climate change documentaries AND year=2020' }],
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

    input.value = 'climate chang documentaries from 2020'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual([
      { kind: 'expression', text: 'climate change documentaries AND year=2020' },
    ])
  })

  it('leaves a bare, unscoped multi-word term unquoted in the lucene format', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [{ kind: 'expression', fields: [{ value: 'climate change' }] }],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"title"}]')
    shaper.setAttribute('format', 'lucene')

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

    expect((suggestionEvents[0] as Array<{ text: string }>).at(0)?.text).toBe('climate change')
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

  it('quotes a multi-word phrase in simple-query-string even when the model forgot to, bare or fielded', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          {
            kind: 'expression',
            fields: [
              { value: 'exact phrase' },
              { field: 'title', value: 'climate change', operator: '+' },
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

    input.value = 'exact phrase climate change'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect((suggestionEvents[0] as Array<{ text: string }>).at(0)?.text).toBe(
      '"exact phrase" +title:"climate change"',
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

  it('retries a bounded number of times on a transient UnknownError, succeeding if a later attempt works', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const unknownError = Object.assign(new Error('An unknown error occurred: kErrorUnknown'), { name: 'UnknownError' })
    lm.clonedSession.prompt
      .mockRejectedValueOnce(unknownError)
      .mockRejectedValueOnce(unknownError)
      .mockResolvedValueOnce(JSON.stringify({ suggestions: [{ kind: 'correction', text: 'fixed' }] }))
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

    expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(3)
    expect(suggestionEvents[0]).toEqual([{ kind: 'correction', text: 'fixed' }])
  })

  it('gives up and emits query-shaper-error after exhausting UnknownError retries', async () => {
    const lm = mockLanguageModel({ availability: 'available' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const unknownError = Object.assign(new Error('An unknown error occurred: kErrorUnknown'), { name: 'UnknownError' })
    lm.clonedSession.prompt.mockRejectedValue(unknownError)
    const { shaper, input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const errorEvents: unknown[] = []
    shaper.addEventListener('query-shaper-error', (e) => {
      errorEvents.push((e as CustomEvent).detail)
    })

    input.value = 'climat change'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(errorEvents).toHaveLength(1))

    expect(lm.clonedSession.prompt.mock.calls.length).toBeGreaterThan(1)
    expect((errorEvents[0] as { phase: string }).phase).toBe('generate')
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
