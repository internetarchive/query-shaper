import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetSharedSessionForTests } from '../query-shaper.js'
import { mockLanguageModel, mount } from './test-helpers.js'

describe('QueryShaper session lifecycle', () => {
  afterEach(() => {
    __resetSharedSessionForTests()
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel
    document.body.innerHTML = ''
    document.documentElement.lang = ''
  })

  it('emits an unavailable status when the browser has no LanguageModel API', async () => {
    const { shaper, input } = mount()
    const statusEvents: string[] = []
    shaper.addEventListener('query-shaper-status', (e) => {
      statusEvents.push((e as CustomEvent).detail.status)
    })

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(statusEvents).toEqual(['unavailable']))
  })

  it('creates a session from the shared base when the model is available', async () => {
    const lm = mockLanguageModel({ availability: 'available' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))

    await vi.waitFor(() => expect(lm.availability).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(lm.create).toHaveBeenCalledTimes(1))
    expect(lm.baseSession.clone).toHaveBeenCalledTimes(1)
  })

  it('emits a downloadable status without creating a session when the model needs downloading', async () => {
    const lm = mockLanguageModel({ availability: 'downloadable' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    const statusEvents: string[] = []
    shaper.addEventListener('query-shaper-status', (e) => {
      statusEvents.push((e as CustomEvent).detail.status)
    })

    input.dispatchEvent(new Event('focus'))

    await vi.waitFor(() => expect(statusEvents).toEqual(['downloadable']))
    expect(lm.create).not.toHaveBeenCalled()
  })

  it('shares one base session across instances, cloning a separate one per instance', async () => {
    const lm = mockLanguageModel({ availability: 'available' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm

    const first = mount()
    first.input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    const second = mount('search-2')
    second.input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(2))

    expect(lm.create).toHaveBeenCalledTimes(1)
  })

  it('destroys only its own clone on disconnect, never the shared base', async () => {
    const lm = mockLanguageModel({ availability: 'available' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))

    shaper.remove()

    expect(lm.clonedSession.destroy).toHaveBeenCalledTimes(1)
    expect(lm.baseSession.destroy).not.toHaveBeenCalled()
  })

  it('only checks availability once per instance across repeated focuses', async () => {
    const lm = mockLanguageModel({ availability: 'available' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.availability).toHaveBeenCalledTimes(1))

    input.dispatchEvent(new Event('focus'))
    input.dispatchEvent(new Event('focus'))

    expect(lm.availability).toHaveBeenCalledTimes(1)
  })

  it('declares expectedInputs/expectedOutputs, defaulting to en when no document language is set', async () => {
    const lm = mockLanguageModel({ availability: 'available' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.create).toHaveBeenCalledTimes(1))

    const expectedOptions = {
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    }
    expect(lm.availability).toHaveBeenCalledWith(expectedOptions)
    expect(lm.create).toHaveBeenCalledWith(expectedOptions)
  })

  it('uses the document language when it is one of the models supported languages', async () => {
    document.documentElement.lang = 'es'
    const lm = mockLanguageModel({ availability: 'available' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.create).toHaveBeenCalledTimes(1))

    expect(lm.create).toHaveBeenCalledWith({
      expectedInputs: [{ type: 'text', languages: ['es'] }],
      expectedOutputs: [{ type: 'text', languages: ['es'] }],
    })
  })

  it('falls back to en when the document language is not one of the models supported languages', async () => {
    document.documentElement.lang = 'zh-CN'
    const lm = mockLanguageModel({ availability: 'available' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.create).toHaveBeenCalledTimes(1))

    expect(lm.create).toHaveBeenCalledWith({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    })
  })

  it('does not accumulate duplicate listeners across a disconnect/reconnect cycle', async () => {
    const lm = mockLanguageModel({ availability: 'available' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()

    shaper.remove()
    document.body.appendChild(shaper)

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.availability).toHaveBeenCalledTimes(1))

    expect(lm.availability).toHaveBeenCalledTimes(1)
  })
})
