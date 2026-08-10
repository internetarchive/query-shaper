import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetSharedSessionForTests } from '../query-shaper.js'
import { mockLanguageModel, mount } from './test-helpers.js'

describe('QueryShaper download prompt', () => {
  afterEach(() => {
    __resetSharedSessionForTests()
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel
    document.body.innerHTML = ''
    localStorage.clear()
  })

  it('shows an enable/dismiss message when status is downloadable', async () => {
    const lm = mockLanguageModel({ availability: 'downloadable' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(shaper.shadowRoot?.querySelector('[part="download-prompt"]')).not.toBeNull())

    const prompt = shaper.shadowRoot?.querySelector('[part="download-prompt"]')
    expect(prompt?.querySelector('[part="download-enable"]')).not.toBeNull()
    expect(prompt?.querySelector('[part="download-dismiss"]')).not.toBeNull()
  })

  it('does not show the message when headless', async () => {
    const lm = mockLanguageModel({ availability: 'downloadable' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('headless', '')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.availability).toHaveBeenCalledTimes(1))

    expect(shaper.shadowRoot?.querySelector('[part="download-prompt"]')).toBeNull()
  })

  it('hides the message and remembers dismissal in localStorage when dismissed', async () => {
    const lm = mockLanguageModel({ availability: 'downloadable' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(shaper.shadowRoot?.querySelector('[part="download-prompt"]')).not.toBeNull())

    const dismissButton = shaper.shadowRoot?.querySelector('[part="download-dismiss"]') as HTMLElement
    dismissButton.click()

    expect(shaper.shadowRoot?.querySelector('[part="download-prompt"]')).toBeNull()
    expect(localStorage.getItem('query-shaper:download-prompt-dismissed')).toBe('true')
  })

  it('does not show the message again once dismissal was previously recorded', async () => {
    localStorage.setItem('query-shaper:download-prompt-dismissed', 'true')
    const lm = mockLanguageModel({ availability: 'downloadable' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { input, shaper } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.availability).toHaveBeenCalledTimes(1))

    expect(shaper.shadowRoot?.querySelector('[part="download-prompt"]')).toBeNull()
  })

  it('triggers the model download when Enable is clicked, and emits available once ready', async () => {
    const lm = mockLanguageModel({ availability: 'downloadable' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    const statusEvents: string[] = []
    shaper.addEventListener('query-shaper-status', (e) => {
      statusEvents.push((e as CustomEvent).detail.status)
    })

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(shaper.shadowRoot?.querySelector('[part="download-prompt"]')).not.toBeNull())

    const enableButton = shaper.shadowRoot?.querySelector('[part="download-enable"]') as HTMLElement
    enableButton.click()

    await vi.waitFor(() => expect(lm.create).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(statusEvents).toEqual(['downloadable', 'available']))
  })

  it('exposes a public download() method a headless consumer can call directly, with no built-in button', async () => {
    const lm = mockLanguageModel({ availability: 'downloadable' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('headless', '')
    const statusEvents: string[] = []
    shaper.addEventListener('query-shaper-status', (e) => {
      statusEvents.push((e as CustomEvent).detail.status)
    })

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(statusEvents).toEqual(['downloadable']))
    expect(shaper.shadowRoot?.querySelector('[part="download-prompt"]')).toBeNull()

    await shaper.download()

    expect(lm.create).toHaveBeenCalledTimes(1)
    expect(lm.baseSession.clone).toHaveBeenCalledTimes(1)
    expect(statusEvents).toEqual(['downloadable', 'available'])
  })

  it('fires the pending search once download() finishes, even if typed before the model was ready', async () => {
    const lm = mockLanguageModel({ availability: 'downloadable', promptResponse: { suggestions: [] } })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('headless', '')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.availability).toHaveBeenCalledTimes(1))

    // Typed and paused while still downloadable — no session yet, nothing to prompt.
    input.value = 'climate change'
    input.dispatchEvent(new Event('input'))
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(lm.clonedSession.prompt).not.toHaveBeenCalled()

    await shaper.download()

    await vi.waitFor(() => expect(lm.clonedSession.prompt).toHaveBeenCalledTimes(1))
  })

  it('shows an informational message with no buttons when status is downloading', async () => {
    const lm = mockLanguageModel({ availability: 'downloading' })
    let resolveCreate: (session: unknown) => void = () => {}
    lm.create.mockImplementation(() => new Promise((resolve) => (resolveCreate = resolve)))
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(shaper.shadowRoot?.querySelector('[part="downloading-notice"]')).not.toBeNull())

    const notice = shaper.shadowRoot?.querySelector('[part="downloading-notice"]')
    expect(notice?.textContent).toMatch(/background/i)
    expect(notice?.textContent).toMatch(/ready/i)
    expect(notice?.querySelector('button')).toBeNull()

    resolveCreate(lm.baseSession)
  })

  it('does not show the downloading notice when headless', async () => {
    const lm = mockLanguageModel({ availability: 'downloading' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    shaper.setAttribute('headless', '')

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(lm.availability).toHaveBeenCalledTimes(1))

    expect(shaper.shadowRoot?.querySelector('[part="downloading-notice"]')).toBeNull()
  })

  it('creates a session once an in-progress download completes, clearing the notice and emitting available', async () => {
    const lm = mockLanguageModel({ availability: 'downloading' })
    let resolveCreate: (session: unknown) => void = () => {}
    lm.create.mockImplementation(() => new Promise((resolve) => (resolveCreate = resolve)))
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()
    const statusEvents: string[] = []
    shaper.addEventListener('query-shaper-status', (e) => {
      statusEvents.push((e as CustomEvent).detail.status)
    })

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(shaper.shadowRoot?.querySelector('[part="downloading-notice"]')).not.toBeNull())
    expect(statusEvents).toEqual(['downloading'])

    resolveCreate(lm.baseSession)

    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(statusEvents).toEqual(['downloading', 'available']))

    expect(shaper.shadowRoot?.querySelector('[part="downloading-notice"]')).toBeNull()
  })
})
