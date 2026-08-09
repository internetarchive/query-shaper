import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetSharedSessionForTests, QueryShaper } from '../query-shaper.js'
import { mockLanguageModel, mount } from './test-helpers.js'

describe('QueryShaper Examples', () => {
  afterEach(() => {
    __resetSharedSessionForTests()
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel
    document.body.innerHTML = ''
  })

  it('parses a JSON array examples attribute into a structured array', () => {
    const shaper = new QueryShaper()
    shaper.setAttribute('examples', '[{"input":"cheap electronics","suggestions":["price:[0 TO 50]"]}]')
    document.body.appendChild(shaper)

    expect(shaper.examples).toEqual([{ input: 'cheap electronics', suggestions: ['price:[0 TO 50]'] }])
  })

  it('falls back to the raw string when the examples attribute is not valid JSON', () => {
    const shaper = new QueryShaper()
    shaper.setAttribute('examples', 'not valid json')
    document.body.appendChild(shaper)

    expect(shaper.examples).toBe('not valid json')
  })

  it('has no Examples when neither the attribute nor the property is set', () => {
    const shaper = new QueryShaper()
    document.body.appendChild(shaper)

    expect(shaper.examples).toBeUndefined()
  })

  it('lets the imperative property override the attribute', () => {
    const shaper = new QueryShaper()
    shaper.setAttribute('examples', '[{"input":"a","suggestions":["b"]}]')
    document.body.appendChild(shaper)

    shaper.examples = [{ input: 'c', suggestions: ['d'] }]

    expect(shaper.examples).toEqual([{ input: 'c', suggestions: ['d'] }])
  })

  it('includes Examples in the append() call that primes the instance session, alongside Fields', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"price"}]')
    shaper.setAttribute(
      'examples',
      '[{"input":"cheap electronics","suggestions":["category:electronics AND price:[0 TO 50]"]}]',
    )

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    const [[message]] = lm.instanceSession.append.mock.calls[0] as [[{ content: string }]]
    expect(message.content).toContain('Available fields:')
    expect(message.content).toContain('Examples:')
    expect(message.content).toContain('cheap electronics')
    expect(message.content).toContain('category:electronics AND price:[0 TO 50]')
  })

  it('renders every suggestion for an example whose input has more than one good answer', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"price"}]')
    shaper.setAttribute(
      'examples',
      '[{"input":"cheap electronics","suggestions":["category:electronics AND price:[0 TO 50]","cheap electronics"]}]',
    )

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    const [[message]] = lm.instanceSession.append.mock.calls[0] as [[{ content: string }]]
    expect(message.content).toContain('category:electronics AND price:[0 TO 50]')
    expect(message.content).toContain('"cheap electronics"')
  })

  it('escapes a quote already inside a suggestion instead of nesting it unescaped', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"subject"}]')
    shaper.setAttribute(
      'examples',
      '[{"input":"climate docs","suggestions":["subject:\\"climate change\\""]}]',
    )

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    const [[message]] = lm.instanceSession.append.mock.calls[0] as [[{ content: string }]]
    expect(message.content).toContain('"subject:\\"climate change\\""')
  })

  it('rebuilds the primed instance session when Examples changes imperatively', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"price"}]')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    shaper.examples = [{ input: 'cheap', suggestions: ['price:10'] }]

    input.value = 'query'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(2), { timeout: 2000 })

    const [[message]] = lm.instanceSession.append.mock.calls[1] as [[{ content: string }]]
    expect(message.content).toContain('Examples:')
  })
})
