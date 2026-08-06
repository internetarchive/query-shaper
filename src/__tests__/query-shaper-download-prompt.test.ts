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

  it('triggers the model download when Enable is clicked', async () => {
    const lm = mockLanguageModel({ availability: 'downloadable' })
    ;(globalThis as { LanguageModel?: unknown }).LanguageModel = lm
    const { shaper, input } = mount()

    input.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(shaper.shadowRoot?.querySelector('[part="download-prompt"]')).not.toBeNull())

    const enableButton = shaper.shadowRoot?.querySelector('[part="download-enable"]') as HTMLElement
    enableButton.click()

    await vi.waitFor(() => expect(lm.create).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(lm.baseSession.clone).toHaveBeenCalledTimes(1))
  })
})
