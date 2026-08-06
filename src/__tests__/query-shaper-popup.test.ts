import { afterEach, describe, expect, it } from 'vitest'
import { mount } from './test-helpers.js'

describe('QueryShaper popup', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('attaches an open Shadow DOM to render into', () => {
    const { shaper } = mount()

    expect(shaper.shadowRoot).not.toBeNull()
    expect(shaper.shadowRoot?.mode).toBe('open')
  })

  it('includes a stylesheet using custom properties for host theming', () => {
    const { shaper } = mount()

    const style = shaper.shadowRoot?.querySelector('style')
    expect(style).not.toBeNull()
    expect(style?.textContent).toContain('var(--query-shaper-')
  })

  it('exposes the popup container via ::part() for host theming', () => {
    const { shaper } = mount()

    expect(shaper.shadowRoot?.querySelector('[part="popup"]')).not.toBeNull()
  })

  it('wires aria-controls on the Target to the rendered listbox', () => {
    const { shaper, input } = mount()

    shaper.dispatchEvent(
      new CustomEvent('query-shaper-suggestions', {
        detail: { suggestions: [{ kind: 'correction', text: 'climate change' }] },
      }),
    )

    const listbox = shaper.shadowRoot?.querySelector('[role="listbox"]')
    expect(listbox?.id).toBeTruthy()
    expect(input.getAttribute('aria-controls')).toBe(listbox?.id)
  })

  it('renders an option per suggestion when query-shaper-suggestions fires', () => {
    const { shaper } = mount()

    shaper.dispatchEvent(
      new CustomEvent('query-shaper-suggestions', {
        detail: {
          suggestions: [
            { kind: 'correction', text: 'climate change' },
            { kind: 'expansion', text: 'global warming' },
          ],
        },
      }),
    )

    const options = shaper.shadowRoot?.querySelectorAll('[role="option"]')
    expect(options).toHaveLength(2)
    expect(options?.[0]?.textContent).toBe('climate change')
    expect(options?.[1]?.textContent).toBe('global warming')
  })

  it('renders nothing when headless, even though the event still fires normally', () => {
    const { shaper } = mount()
    shaper.setAttribute('headless', '')

    let eventFired = false
    shaper.addEventListener('query-shaper-suggestions', () => {
      eventFired = true
    })
    shaper.dispatchEvent(
      new CustomEvent('query-shaper-suggestions', {
        detail: { suggestions: [{ kind: 'correction', text: 'climate change' }] },
      }),
    )

    expect(eventFired).toBe(true)
    expect(shaper.shadowRoot?.querySelectorAll('[role="option"]')).toHaveLength(0)
  })

  it('does not touch the Target\'s ARIA attributes at all when headless', () => {
    const { shaper, input } = mount()
    shaper.setAttribute('headless', '')

    shaper.dispatchEvent(
      new CustomEvent('query-shaper-suggestions', {
        detail: { suggestions: [{ kind: 'correction', text: 'climate change' }] },
      }),
    )

    expect(input.hasAttribute('role')).toBe(false)
    expect(input.hasAttribute('aria-expanded')).toBe(false)
    expect(input.hasAttribute('aria-controls')).toBe(false)
  })

  it('groups rendered options by kind, in kind order', () => {
    const { shaper } = mount()

    shaper.dispatchEvent(
      new CustomEvent('query-shaper-suggestions', {
        detail: {
          suggestions: [
            { kind: 'expansion', text: 'global warming' },
            { kind: 'correction', text: 'climate change' },
            { kind: 'expression', text: 'title:climate', fields: [] },
          ],
        },
      }),
    )

    const groups = shaper.shadowRoot?.querySelectorAll('[part="option-group"]')
    expect(groups).toHaveLength(3)
    expect(groups?.[0]?.getAttribute('data-kind')).toBe('correction')
    expect(groups?.[1]?.getAttribute('data-kind')).toBe('expansion')
    expect(groups?.[2]?.getAttribute('data-kind')).toBe('expression')
    expect(groups?.[0]?.querySelector('[role="option"]')?.textContent).toBe('climate change')
  })

  it('accepts the clicked suggestion', () => {
    const { shaper, input } = mount()

    shaper.dispatchEvent(
      new CustomEvent('query-shaper-suggestions', {
        detail: {
          suggestions: [
            { kind: 'correction', text: 'climate change' },
            { kind: 'expansion', text: 'global warming' },
          ],
        },
      }),
    )

    const options = shaper.shadowRoot?.querySelectorAll('[role="option"]')
    ;(options?.[1] as HTMLElement).click()

    expect(input.value).toBe('global warming')
  })

  it('prevents default on navigation keys so they do not affect the native input', () => {
    const { shaper, input } = mount()
    shaper.dispatchEvent(
      new CustomEvent('query-shaper-suggestions', {
        detail: { suggestions: [{ kind: 'correction', text: 'one' }] },
      }),
    )

    const arrowDown = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    input.dispatchEvent(arrowDown)
    expect(arrowDown.defaultPrevented).toBe(true)

    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    input.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(true)
  })

  it('prevents default on mousedown within the listbox so the Target never blurs', () => {
    const { shaper } = mount()
    shaper.dispatchEvent(
      new CustomEvent('query-shaper-suggestions', {
        detail: { suggestions: [{ kind: 'correction', text: 'one' }] },
      }),
    )

    const listbox = shaper.shadowRoot?.querySelector('[role="listbox"]') as HTMLElement
    const mousedown = new MouseEvent('mousedown', { cancelable: true })
    listbox.dispatchEvent(mousedown)

    expect(mousedown.defaultPrevented).toBe(true)
  })

  it('marks the Target as an expanded combobox while suggestions are shown', () => {
    const { shaper, input } = mount()

    shaper.dispatchEvent(
      new CustomEvent('query-shaper-suggestions', {
        detail: { suggestions: [{ kind: 'correction', text: 'climate change' }] },
      }),
    )

    expect(input.getAttribute('role')).toBe('combobox')
    expect(input.getAttribute('aria-expanded')).toBe('true')
  })

  it('collapses the combobox when an empty suggestion list arrives', () => {
    const { shaper, input } = mount()
    shaper.dispatchEvent(
      new CustomEvent('query-shaper-suggestions', {
        detail: { suggestions: [{ kind: 'correction', text: 'climate change' }] },
      }),
    )

    shaper.dispatchEvent(new CustomEvent('query-shaper-suggestions', { detail: { suggestions: [] } }))

    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(shaper.shadowRoot?.querySelectorAll('[role="option"]')).toHaveLength(0)
  })

  it('moves the active option with arrow keys and updates aria-activedescendant', () => {
    const { shaper, input } = mount()
    shaper.dispatchEvent(
      new CustomEvent('query-shaper-suggestions', {
        detail: {
          suggestions: [
            { kind: 'correction', text: 'one' },
            { kind: 'correction', text: 'two' },
          ],
        },
      }),
    )

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))

    const options = shaper.shadowRoot?.querySelectorAll('[role="option"]')
    expect(options?.[0]?.getAttribute('aria-selected')).toBe('false')
    expect(options?.[1]?.getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe(options?.[1]?.id)
  })

  it('accepts the active option on Enter', () => {
    const { shaper, input } = mount()
    shaper.dispatchEvent(
      new CustomEvent('query-shaper-suggestions', {
        detail: {
          suggestions: [
            { kind: 'correction', text: 'one' },
            { kind: 'correction', text: 'two' },
          ],
        },
      }),
    )

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(input.value).toBe('two')
  })

  it('closes the popup on Escape without accepting', () => {
    const { shaper, input } = mount()
    shaper.dispatchEvent(
      new CustomEvent('query-shaper-suggestions', {
        detail: { suggestions: [{ kind: 'correction', text: 'one' }] },
      }),
    )

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(input.value).toBe('')
    expect(shaper.shadowRoot?.querySelectorAll('[role="option"]')).toHaveLength(0)
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes the popup when the Target loses focus', () => {
    const { shaper, input } = mount()
    shaper.dispatchEvent(
      new CustomEvent('query-shaper-suggestions', {
        detail: { suggestions: [{ kind: 'correction', text: 'one' }] },
      }),
    )

    input.dispatchEvent(new Event('blur'))

    expect(shaper.shadowRoot?.querySelectorAll('[role="option"]')).toHaveLength(0)
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })
})
