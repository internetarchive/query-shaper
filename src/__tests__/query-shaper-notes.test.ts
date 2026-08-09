import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetSharedSessionForTests, QueryShaper } from '../query-shaper.js'
import { mockLanguageModel, mount } from './test-helpers.js'

describe('QueryShaper Notes', () => {
  afterEach(() => {
    __resetSharedSessionForTests()
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel
    document.body.innerHTML = ''
  })

  it('reads Notes from the attribute as a plain string', () => {
    const shaper = new QueryShaper()
    shaper.setAttribute('notes', 'Prices are always in USD.')
    document.body.appendChild(shaper)

    expect(shaper.notes).toBe('Prices are always in USD.')
  })

  it('has no Notes when neither the attribute nor the property is set', () => {
    const shaper = new QueryShaper()
    document.body.appendChild(shaper)

    expect(shaper.notes).toBeUndefined()
  })

  it('lets the imperative property override the attribute', () => {
    const shaper = new QueryShaper()
    shaper.setAttribute('notes', 'from attribute')
    document.body.appendChild(shaper)

    shaper.notes = 'from property'

    expect(shaper.notes).toBe('from property')
  })

  it('includes Notes in the append() call that primes the instance session, alongside Fields', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"price"}]')
    shaper.setAttribute('notes', 'Prices are always in USD, never assume another currency.')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    const [[message]] = lm.instanceSession.append.mock.calls[0] as [[{ content: string }]]
    expect(message.content).toContain('Available fields:')
    expect(message.content).toContain('Notes:')
    expect(message.content).toContain('Prices are always in USD')
  })

  it('rebuilds the primed instance session when Notes changes imperatively', async () => {
    const lm = mockLanguageModel({ promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('fields', '[{"name":"price"}]')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(1))

    shaper.notes = 'a new note'

    input.value = 'query'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(lm.instanceSession.append).toHaveBeenCalledTimes(2), { timeout: 2000 })

    const [[message]] = lm.instanceSession.append.mock.calls[1] as [[{ content: string }]]
    expect(message.content).toContain('a new note')
  })
})
