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
      .mockImplementationOnce(() => Promise.resolve(JSON.stringify({ suggestions: ['second, newer result'] })))

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
    expect(suggestionEvents[0]).toEqual(['second, newer result'])

    resolveFirst(JSON.stringify({ suggestions: ['first, STALE result'] }))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(suggestionEvents).toHaveLength(1)
  })

  it('generates suggestions from a debounced input and emits them', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['climate change', 'global warming'] },
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

    expect(suggestionEvents[0]).toEqual(['climate change', 'global warming'])
  })

  it('excludes a suggestion identical to the Search Text, keeping the rest', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['climate change', 'climate change', 'global warming'] },
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

    expect(suggestionEvents[0]).toEqual(['global warming'])
  })

  it('excludes a fielded suggestion whose rendered text is identical to the Search Text', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['title:climate'] },
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

    input.value = 'title:climate'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual([])
  })

  it('skips the model call and clears suggestions when the Target is cleared', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['climate change'] },
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

  it('uses the model\'s raw Lucene text verbatim for the lucene format, without reinterpreting it', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['title:"climate change" AND year:2020'] },
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

    expect(suggestionEvents[0]).toEqual(['title:"climate change" AND year:2020'])
  })

  it('leaves a bare, unscoped multi-word phrase unquoted in the lucene format', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['climate change'] },
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

    expect((suggestionEvents[0] as string[]).at(0)).toBe('climate change')
  })

  it('shows a suggestion that is entirely one range verbatim in the lucene format, rather than dropping it', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['price:[0 TO 20]'] },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"price"}]')
    shaper.setAttribute('format', 'lucene')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'cheap stuff'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual(['price:[0 TO 20]'])
  })

  it('drops a suggestion that is entirely one range for a non-lucene format, since nothing is left to render', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['price:[0 TO 20]', 'cheap stuff'] },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"price"}]')
    shaper.setAttribute('format', 'url-params')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'cheap stuff'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual(['q=cheap+stuff'])
  })

  it('drops a suggestion whose query structure cannot be parsed', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['title:climate AND year:', 'climate change'] },
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

    input.value = 'climat change'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual(['climate change'])
  })

  it('renders an expression suggestion using the simple-query-string format', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['+quick -fox "exact phrase" +title:foo'] },
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

    expect((suggestionEvents[0] as string[]).at(0)).toBe('+quick -fox "exact phrase" +title:foo')
  })

  it('renders a bare term under a default q key in the url-params format', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['book language:en'] },
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

    expect((suggestionEvents[0] as string[]).at(0)).toBe('q=book&language=en')
  })

  it('drops a suggestion referencing a field when no Fields are configured', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['climate change', 'title:"climate change"'] },
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

    expect(suggestionEvents[0]).toEqual(['climate change'])
  })

  it('renders an expression suggestion using the url-params format', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['q:book language:en'] },
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

    expect((suggestionEvents[0] as string[]).at(0)).toBe('q=book&language=en')
  })

  it('renders an expression suggestion using a custom .format function', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['title:book'] },
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

    expect((suggestionEvents[0] as string[]).at(0)).toBe('CUSTOM(title=book)')
  })

  it('caps total suggestions at max-suggestions, even if the model returns more', async () => {
    const lm = mockLanguageModel({
      promptResponse: { suggestions: ['a', 'b', 'c'] },
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

    expect(suggestionEvents[0]).toEqual(['a', 'b'])
  })

  it('passes maxSuggestions through to the response schema\'s maxItems constraint', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('max-suggestions', '3')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    input.value = 'x'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    const [, options] = lm.clonedSession.prompt.mock.calls[0] as [
      string,
      { responseConstraint: { properties: { suggestions: { maxItems: number } } } },
    ]
    expect(options.responseConstraint.properties.suggestions.maxItems).toBe(3)
  })

  it('clones a fresh child per query and destroys it after use, reusing the same primed instance session', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    input.value = 'first query'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(lm.clonedSession.destroy).toHaveBeenCalledTimes(1))

    input.value = 'second query'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(lm.clonedSession.destroy).toHaveBeenCalledTimes(2))

    // The instance session (parent) is only ever cloned once from the base — each
    // query clones a fresh, disposable child FROM the parent, not from the base directly.
    expect(lm.baseSession.clone).toHaveBeenCalledTimes(1)
    expect(lm.instanceSession.clone).toHaveBeenCalledTimes(2)
    expect(lm.instanceSession.destroy).not.toHaveBeenCalled()
  })

  it('rebuilds the primed instance session when Fields changes imperatively', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"title"}]')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    input.value = 'first query'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    shaper.fields = [{ name: 'author' }]

    input.value = 'second query'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(2))

    expect(lm.baseSession.clone).toHaveBeenCalledTimes(2)
    expect(lm.instanceSession.destroy).toHaveBeenCalledTimes(1)
    expect(lm.instanceSession.append).toHaveBeenCalledTimes(2)
    const [[firstMessage]] = lm.instanceSession.append.mock.calls[0] as [[{ content: string }]]
    const [[secondMessage]] = lm.instanceSession.append.mock.calls[1] as [[{ content: string }]]
    expect(firstMessage.content).toContain('title')
    expect(secondMessage.content).toContain('author')
  })

  it('does not rebuild the primed instance session across queries when Fields is unchanged', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"title"}]')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    input.value = 'first query'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    input.value = 'second query'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(2))

    expect(lm.baseSession.clone).toHaveBeenCalledTimes(1)
    expect(lm.instanceSession.append).toHaveBeenCalledTimes(1)
    expect(lm.instanceSession.destroy).not.toHaveBeenCalled()
  })

  it('includes the Fields description in the append() call that primes the instance session', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', 'title, author, year')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    const [[message]] = lm.instanceSession.append.mock.calls[0] as [[{ role: string; content: string }]]
    expect(message.role).toBe('user')
    expect(message.content).toContain('title, author, year')

    input.value = 'climate change'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    // Fields now lives upstream (primed once via append()), not resent per query.
    const [promptText] = lm.clonedSession.prompt.mock.calls[0] as [string, unknown]
    expect(promptText).not.toContain('title, author, year')
    expect(promptText).toContain('climate change')
  })

  it('includes prior History entries and originating Search Text in the prompt sent to the model', async () => {
    localStorage.setItem(
      'query-shaper:history:search',
      JSON.stringify([
        { searchText: 'climat chnge', suggestion: 'climate change', timestamp: 1 },
        { searchText: 'docs about ai', suggestion: 'documents about artificial intelligence', timestamp: 2 },
      ]),
    )
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
    expect(promptText).toContain('climat chnge')
    expect(promptText).toContain('climate change')
    expect(promptText).toContain('docs about ai')
    expect(promptText).toContain('documents about artificial intelligence')
  })

  it('only feeds up to max-history entries into the prompt, even if more are stored', async () => {
    localStorage.setItem(
      'query-shaper:history:search',
      JSON.stringify([
        { searchText: 'search one', suggestion: 'result one', timestamp: 1 },
        { searchText: 'search two', suggestion: 'result two', timestamp: 2 },
        { searchText: 'search three', suggestion: 'result three', timestamp: 3 },
        { searchText: 'search four', suggestion: 'result four', timestamp: 4 },
      ]),
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

  it('reads History from an in-memory cache after the first read, without re-reading localStorage on later queries', async () => {
    localStorage.setItem('query-shaper:history:search', JSON.stringify(['old search']))
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()
    const getItemSpy = vi.spyOn(localStorage, 'getItem')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    input.value = 'first query'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    const historyKeyCalls = () =>
      getItemSpy.mock.calls.filter(([key]) => key === 'query-shaper:history:search').length
    expect(historyKeyCalls()).toBe(1)

    input.value = 'second query'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(2))

    expect(historyKeyCalls()).toBe(1)
    getItemSpy.mockRestore()
  })

  it('reflects a newly recorded entry in the next query without needing a fresh localStorage read', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    input.value = 'first query'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    shaper.accept('accepted text')
    const getItemSpy = vi.spyOn(localStorage, 'getItem')

    input.value = 'second query'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(2))

    const [promptText] = lm.clonedSession.prompt.mock.calls[1] as [string, unknown]
    expect(promptText).toContain('accepted text')
    expect(getItemSpy).not.toHaveBeenCalledWith('query-shaper:history:search')
    getItemSpy.mockRestore()
  })

  it('retries a bounded number of times on a transient UnknownError, succeeding if a later attempt works', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const unknownError = Object.assign(new Error('An unknown error occurred: kErrorUnknown'), { name: 'UnknownError' })
    lm.clonedSession.prompt
      .mockRejectedValueOnce(unknownError)
      .mockRejectedValueOnce(unknownError)
      .mockResolvedValueOnce(JSON.stringify({ suggestions: ['fixed'] }))
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
    expect(suggestionEvents[0]).toEqual(['fixed'])
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

  it('destroys the superseded child session immediately when a newer generation starts, without waiting for its prompt() to settle', async () => {
    vi.useRealTimers()
    const lm = mockLanguageModel({ availability: 'available' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    // Neither call ever settles, so the only possible source of a destroy() call is the
    // proactive supersede-destroy path itself — not either generation's own eventual
    // `finally` block, which this rules out entirely.
    lm.clonedSession.prompt.mockImplementation(() => new Promise<string>(() => {}))

    input.value = 'first query'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1), { timeout: 1000 })

    input.value = 'second different query'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(2), { timeout: 1000 })

    await vi.waitFor(() => expect(lm.clonedSession.destroy).toHaveBeenCalledTimes(1), { timeout: 1000 })
  })

  it('destroys the in-flight child session immediately when the search text is cleared', async () => {
    vi.useRealTimers()
    const lm = mockLanguageModel({ availability: 'available' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const neverResolving = new Promise<string>(() => {})
    lm.clonedSession.prompt.mockImplementationOnce(() => neverResolving)

    input.value = 'a query'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1), { timeout: 1000 })

    input.value = ''
    input.dispatchEvent(new Event('input'))

    await vi.waitFor(() => expect(lm.clonedSession.destroy).toHaveBeenCalledTimes(1), { timeout: 1000 })
  })

  it('destroys the in-flight child a grace period after blur, if no result has arrived yet', async () => {
    const lm = mockLanguageModel({ availability: 'available' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const neverResolving = new Promise<string>(() => {})
    lm.clonedSession.prompt.mockImplementationOnce(() => neverResolving)

    input.value = 'a query'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    input.dispatchEvent(new Event('blur'))
    expect(lm.clonedSession.destroy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => expect(lm.clonedSession.destroy).toHaveBeenCalledTimes(1))
  })

  it('cancels the pending blur-destroy if the field is refocused before the grace period elapses', async () => {
    const lm = mockLanguageModel({ availability: 'available' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const neverResolving = new Promise<string>(() => {})
    lm.clonedSession.prompt.mockImplementationOnce(() => neverResolving)

    input.value = 'a query'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    input.dispatchEvent(new Event('blur'))
    await vi.advanceTimersByTimeAsync(1500)
    input.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(3000)

    expect(lm.clonedSession.destroy).not.toHaveBeenCalled()
  })

  it('trims the oldest History entry and retries on context overflow', async () => {
    localStorage.setItem(
      'query-shaper:history:search',
      JSON.stringify([
        { searchText: 'old search one', suggestion: 'result one', timestamp: 1 },
        { searchText: 'old search two', suggestion: 'result two', timestamp: 2 },
      ]),
    )
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
