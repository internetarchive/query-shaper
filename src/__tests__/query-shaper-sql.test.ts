import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetSharedSessionForTests } from '../query-shaper.js'
import { mockLanguageModel, mount } from './test-helpers.js'

describe('QueryShaper SQL', () => {
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

  it('describes a Resource-keyed Fields object as tables/files in the append() priming call', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute(
      'fields',
      '{"books":[{"name":"title"},{"name":"year"}],"read_csv(\'categories.csv\')":[{"name":"id"},{"name":"name"}]}',
    )
    shaper.setAttribute('format', 'sql')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    const [[message]] = lm.instanceSession.append.mock.calls[0] as [[{ content: string }]]
    const primingContent = message.content
    expect(primingContent).toContain('Available tables:')
    expect(primingContent).toContain('- books(title, year)')
    expect(primingContent).toContain('Available files (DuckDB can query these directly — local or remote):')
    expect(primingContent).toContain("- read_csv('categories.csv')(id, name)")
    expect(primingContent).toContain('Write SQL for DuckDB.')
  })

  it('describes a bare Fields array + resource attribute as a single table/file line', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"title"},{"name":"year"}]')
    shaper.setAttribute('resource', 'books')
    shaper.setAttribute('format', 'sql')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    const [[message]] = lm.instanceSession.append.mock.calls[0] as [[{ content: string }]]
    const primingContent = message.content
    expect(primingContent).toContain('Available tables:')
    expect(primingContent).toContain('- books(title, year)')
    expect(primingContent).toContain('Write SQL for DuckDB.')
  })

  it('classifies a quoted-path resource attribute as a file', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"title"},{"name":"year"}]')
    shaper.setAttribute('resource', "'data.parquet'")
    shaper.setAttribute('format', 'sql')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    const [[message]] = lm.instanceSession.append.mock.calls[0] as [[{ content: string }]]
    const primingContent = message.content
    expect(primingContent).toContain('Available files (DuckDB can query these directly — local or remote):')
    expect(primingContent).toContain("- 'data.parquet'(title, year)")
  })

  it('passes free-form text Fields through as-is under sql, still adding the DuckDB instruction', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', 'there is a books table with title, year, author columns')
    shaper.setAttribute('format', 'sql')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    const [[message]] = lm.instanceSession.append.mock.calls[0] as [[{ content: string }]]
    const primingContent = message.content
    expect(primingContent).toContain('there is a books table with title, year, author columns')
    expect(primingContent).toContain('Write SQL for DuckDB.')
  })

  it('falls back to a generic fields listing under sql when no resource is declared', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"title"},{"name":"year"}]')
    shaper.setAttribute('format', 'sql')
    // deliberately no `resource` attribute

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    const [[message]] = lm.instanceSession.append.mock.calls[0] as [[{ content: string }]]
    const primingContent = message.content
    expect(primingContent).toContain('Available fields:')
    expect(primingContent).toContain('Write SQL for DuckDB.')
  })

  it('falls back to JSON.stringify for a Resource-keyed Fields object under a non-sql format', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '{"books":[{"name":"title"}]}')
    shaper.setAttribute('format', 'lucene')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    const [[message]] = lm.instanceSession.append.mock.calls[0] as [[{ content: string }]]
    const primingContent = message.content
    expect(primingContent).toContain('{"books":[{"name":"title"}]}')
    expect(primingContent).not.toContain('[object Object]')
  })

  it('uses the model-authored text verbatim for a sql Expression, with no fields property', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [{ kind: 'expression', text: "SELECT * FROM books WHERE year > 2020" }],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"title"},{"name":"year"}]')
    shaper.setAttribute('resource', 'books')
    shaper.setAttribute('format', 'sql')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'books after 2020'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual([
      { kind: 'expression', text: 'SELECT * FROM books WHERE year > 2020' },
    ])
  })

  it('lets the model write a JOIN across two declared tables verbatim', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          {
            kind: 'expression',
            text: 'SELECT * FROM books JOIN categories ON books.category_id = categories.id',
          },
        ],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute(
      'fields',
      '{"books":[{"name":"title"},{"name":"category_id"}],"categories":[{"name":"id"},{"name":"name"}]}',
    )
    shaper.setAttribute('format', 'sql')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    input.value = 'books in the fiction category'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect((suggestionEvents[0] as Array<{ text: string }>).at(0)?.text).toBe(
      'SELECT * FROM books JOIN categories ON books.category_id = categories.id',
    )
  })
})
