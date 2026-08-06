import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetSharedSessionForTests } from './query-shaper.js'
import { mockLanguageModel, mount } from './test-helpers.js'

describe('QueryShaper error handling', () => {
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

  it('emits query-shaper-error and keeps the Target working when generation fails', async () => {
    const lm = mockLanguageModel({ promptError: new Error('boom') })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const errorEvents: unknown[] = []
    const suggestionEvents: unknown[] = []
    shaper.addEventListener('query-shaper-error', (e) => errorEvents.push((e as CustomEvent).detail))
    shaper.addEventListener('query-shaper-suggestions', (e) => suggestionEvents.push((e as CustomEvent).detail))

    input.value = 'climate change'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(errorEvents).toHaveLength(1))

    expect(suggestionEvents).toHaveLength(0)
    expect((errorEvents[0] as { error: Error; phase: string }).phase).toBe('generate')
    expect((errorEvents[0] as { error: Error }).error).toBeInstanceOf(Error)

    // the Target still behaves like a normal input afterward
    input.value = 'still works'
    expect(input.value).toBe('still works')
  })
})
