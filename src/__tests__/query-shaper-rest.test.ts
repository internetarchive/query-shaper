import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetSharedSessionForTests } from '../query-shaper.js'
import { mockLanguageModel, mount } from './test-helpers.js'

async function generate(lm: ReturnType<typeof mockLanguageModel>, input: HTMLInputElement, text: string) {
  input.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))
  input.value = text
  input.dispatchEvent(new Event('input'))
  await vi.advanceTimersByTimeAsync(400)
}

describe('QueryShaper REST-API', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    __resetSharedSessionForTests()
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel
    document.body.innerHTML = ''
    localStorage.clear()
    history.pushState({}, '', '/')
  })

  it('composes base + model-selected Resource + query string for a Resource-keyed Fields object', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          { kind: 'expression', resource: 'questions', fields: [{ field: 'author', value: 'sawood' }] },
        ],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute(
      'fields',
      '{"questions":[{"name":"author"}],"responses":[{"name":"question_id"}]}',
    )
    shaper.setAttribute('format', 'rest-api')

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    await generate(lm, input, 'questions by sawood')
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual([
      {
        kind: 'expression',
        text: 'http://localhost:3000/questions?author=sawood',
        fields: [{ field: 'author', value: 'sawood' }],
        resource: 'questions',
      },
    ])
  })

  it('uses the resource attribute as a fixed endpoint, ignoring any resource the model returns', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          { kind: 'expression', resource: 'responses', fields: [{ field: 'author', value: 'sawood' }] },
        ],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"author"}]')
    shaper.setAttribute('resource', 'books')
    shaper.setAttribute('format', 'rest-api')

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    await generate(lm, input, 'books by sawood')
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual([
      {
        kind: 'expression',
        text: 'http://localhost:3000/books?author=sawood',
        fields: [{ field: 'author', value: 'sawood' }],
      },
    ])
  })

  it('fills a {name} path placeholder from the same tuple set, leaving the rest as query parameters', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [
          {
            kind: 'expression',
            fields: [
              { field: 'slug', value: 'my question' },
              { field: 'lang', value: 'en' },
            ],
          },
        ],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"slug"},{"name":"lang"}]')
    shaper.setAttribute('resource', 'questions/{slug}')
    shaper.setAttribute('format', 'rest-api')

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    await generate(lm, input, 'my question')
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual([
      {
        kind: 'expression',
        text: 'http://localhost:3000/questions/my%20question?lang=en',
        fields: [{ field: 'lang', value: 'en' }],
      },
    ])
  })

  it('drops the Expression and emits query-shaper-error when a path placeholder cannot be filled', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [{ kind: 'expression', fields: [{ field: 'lang', value: 'en' }] }],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"slug"},{"name":"lang"}]')
    shaper.setAttribute('resource', 'questions/{slug}')
    shaper.setAttribute('format', 'rest-api')

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })
    const errorEvents: unknown[] = []
    shaper.addEventListener('query-shaper-error', (e) => {
      errorEvents.push((e as CustomEvent).detail)
    })

    await generate(lm, input, 'some question')
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual([])
    expect(errorEvents).toHaveLength(1)
    expect((errorEvents[0] as { phase: string }).phase).toBe('rest-path-substitution')
  })

  it('falls back to base alone as the endpoint when the model returns no resource', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [{ kind: 'expression', fields: [{ field: 'q', value: 'test' }] }],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '{"questions":[{"name":"q"}],"responses":[{"name":"q"}]}')
    shaper.setAttribute('format', 'rest-api')

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    await generate(lm, input, 'test')
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect(suggestionEvents[0]).toEqual([
      { kind: 'expression', text: 'http://localhost:3000/?q=test', fields: [{ field: 'q', value: 'test' }] },
    ])
  })

  it('resolves a relative base attribute against the current document URL', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [{ kind: 'expression', fields: [{ field: 'x', value: '1' }] }],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"x"}]')
    shaper.setAttribute('resource', 'items')
    shaper.setAttribute('base', '/api/v1')
    shaper.setAttribute('format', 'rest-api')

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    await generate(lm, input, 'items')
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect((suggestionEvents[0] as Array<{ text: string }>).at(0)?.text).toBe(
      'http://localhost:3000/api/v1/items?x=1',
    )
  })

  it('uses an absolute URL base attribute as-is', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [{ kind: 'expression', fields: [{ field: 'x', value: '1' }] }],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"x"}]')
    shaper.setAttribute('resource', 'items')
    shaper.setAttribute('base', 'https://api.example.com')
    shaper.setAttribute('format', 'rest-api')

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    await generate(lm, input, 'items')
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect((suggestionEvents[0] as Array<{ text: string }>).at(0)?.text).toBe(
      'https://api.example.com/items?x=1',
    )
  })

  it('defaults base to the current document URL with query and fragment stripped', async () => {
    history.pushState({}, '', '/search?q=old#frag')
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [{ kind: 'expression', fields: [{ field: 'x', value: '1' }] }],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"x"}]')
    shaper.setAttribute('resource', 'items')
    shaper.setAttribute('format', 'rest-api')

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    await generate(lm, input, 'items')
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect((suggestionEvents[0] as Array<{ text: string }>).at(0)?.text).toBe(
      'http://localhost:3000/search/items?x=1',
    )
  })

  it('composes url-params Format text as a full URL when a base attribute is set', async () => {
    const lm = mockLanguageModel({
      promptResponse: {
        suggestions: [{ kind: 'expression', fields: [{ field: 'q', value: 'test' }] }],
      },
    })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"q"}]')
    shaper.setAttribute('base', 'https://example.com/api')
    shaper.setAttribute('format', 'url-params')

    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-suggestions', (e) => {
      suggestionEvents.push((e as CustomEvent).detail.suggestions)
    })

    await generate(lm, input, 'test')
    await vi.waitFor(() => expect(suggestionEvents).toHaveLength(1))

    expect((suggestionEvents[0] as Array<{ text: string }>).at(0)?.text).toBe(
      'https://example.com/api?q=test',
    )
  })

  it('describes a Resource-keyed Fields object as available endpoints in the prompt', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute(
      'fields',
      '{"questions":[{"name":"author"}],"responses":[{"name":"question_id"}]}',
    )
    shaper.setAttribute('format', 'rest-api')

    await generate(lm, input, 'questions by sawood')
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    const [promptText] = lm.clonedSession.prompt.mock.calls[0] as [string, unknown]
    expect(promptText).toContain('Available endpoints:')
    expect(promptText).toContain('questions(author)')
    expect(promptText).toContain('responses(question_id)')
    expect(promptText).toContain('resource')
    expect(promptText).toContain('{name}')
  })

  it('describes a bare Fields array + resource attribute as a single endpoint, without asking for a resource echo', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"author"}]')
    shaper.setAttribute('resource', 'books')
    shaper.setAttribute('format', 'rest-api')

    await generate(lm, input, 'books by sawood')
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    const [promptText] = lm.clonedSession.prompt.mock.calls[0] as [string, unknown]
    expect(promptText).toContain('books(author)')
    expect(promptText).not.toContain('Return the endpoint')
  })

  it('passes free-form text Fields through under rest-api, asking the model to return the endpoint it inferred', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', 'questions can be searched at questions, listed at responses')
    shaper.setAttribute('format', 'rest-api')

    await generate(lm, input, 'questions by sawood')
    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))

    const [promptText] = lm.clonedSession.prompt.mock.calls[0] as [string, unknown]
    expect(promptText).toContain('questions can be searched at questions, listed at responses')
    expect(promptText).toContain('resource')
  })
})
