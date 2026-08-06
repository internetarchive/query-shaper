export type FieldDescriptor = {
  name: string
  type?: 'text' | 'number' | 'date'
  aliases?: string[]
  description?: string
}

export type Fields = string | FieldDescriptor[]

export type FieldValue = { field?: string; value: string; operator?: string }
export type FormatPreset = 'lucene' | 'url-params' | 'simple-query-string'
export type FormatRenderer = (fields: FieldValue[]) => string
export type Format = FormatPreset | FormatRenderer

export type LanguageModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

export type LanguageModelSession = {
  clone(): Promise<LanguageModelSession>
  destroy(): void
  prompt(input: string, options?: { responseConstraint?: unknown }): Promise<string>
}

export type LanguageModelAPI = {
  availability(options?: unknown): Promise<LanguageModelAvailability>
  create(options?: unknown): Promise<LanguageModelSession>
}

export type RawSuggestion =
  | { kind: 'correction'; text: string }
  | { kind: 'expansion'; text: string }
  | { kind: 'expression'; fields: FieldValue[] }

export type Suggestion =
  | { kind: 'correction'; text: string }
  | { kind: 'expansion'; text: string }
  | { kind: 'expression'; text: string; fields: FieldValue[] }

const DEBOUNCE_MS = 400
const DOWNLOAD_PROMPT_DISMISSED_KEY = 'query-shaper:download-prompt-dismissed'

const KIND_CONFIG = [
  { kind: 'correction', defaultCap: 1 },
  { kind: 'expansion', defaultCap: 2 },
  { kind: 'expression', defaultCap: 3 },
] as const

const KIND_ORDER = KIND_CONFIG.map((k) => k.kind)
const DEFAULT_KIND_CAPS: Record<string, number> = Object.fromEntries(
  KIND_CONFIG.map((k) => [k.kind, k.defaultCap]),
)

const SHADOW_STYLES = `
  ul { list-style: none; margin: 0; padding: 0; }
  [part="listbox"] {
    background: var(--query-shaper-background, #fff);
    border: 1px solid var(--query-shaper-border-color, #ccc);
    color: var(--query-shaper-color, #111);
    font-family: var(--query-shaper-font-family, inherit);
  }
  [part="option"] {
    padding: var(--query-shaper-option-padding, 0.5em 0.75em);
    cursor: pointer;
  }
  [part="option"][aria-selected="true"] {
    background: var(--query-shaper-active-background, #e0e0ff);
  }
  [part="download-prompt"] {
    background: var(--query-shaper-background, #fff);
    color: var(--query-shaper-color, #111);
    padding: var(--query-shaper-option-padding, 0.5em 0.75em);
  }
`

const SUGGESTIONS_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['correction', 'expansion', 'expression'] },
          text: { type: 'string' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                value: { type: 'string' },
                operator: { type: 'string' },
              },
              required: ['value'],
            },
          },
        },
        required: ['kind'],
      },
    },
  },
  required: ['suggestions'],
}

let sharedBaseSession: Promise<LanguageModelSession> | null = null

export function __resetSharedSessionForTests(): void {
  sharedBaseSession = null
}

export class QueryShaper extends HTMLElement {
  static readonly tagName = 'query-shaper'

  #listboxContainer: HTMLDivElement
  #downloadPromptContainer: HTMLDivElement

  constructor() {
    super()
    const root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = SHADOW_STYLES
    root.appendChild(style)
    const popup = document.createElement('div')
    popup.setAttribute('part', 'popup')
    root.appendChild(popup)
    this.#listboxContainer = document.createElement('div')
    popup.appendChild(this.#listboxContainer)
    this.#downloadPromptContainer = document.createElement('div')
    popup.appendChild(this.#downloadPromptContainer)
  }

  #fieldsOverride: Fields | undefined
  #hasFieldsOverride = false

  get fields(): Fields | undefined {
    if (this.#hasFieldsOverride) return this.#fieldsOverride
    const attr = this.getAttribute('fields')
    if (attr === null) return undefined
    try {
      return JSON.parse(attr)
    } catch {
      return attr
    }
  }

  set fields(value: Fields | undefined) {
    this.#fieldsOverride = value
    this.#hasFieldsOverride = true
  }

  #formatOverride: Format | undefined
  #hasFormatOverride = false

  get format(): Format {
    if (this.#hasFormatOverride) return this.#formatOverride as Format
    const attr = this.getAttribute('format')
    if (attr === 'lucene' || attr === 'url-params' || attr === 'simple-query-string') return attr
    return 'lucene'
  }

  set format(value: Format) {
    this.#formatOverride = value
    this.#hasFormatOverride = true
  }

  get target(): HTMLInputElement | null {
    const forId = this.getAttribute('for')
    if (!forId) return null
    const el = document.getElementById(forId)
    return el instanceof HTMLInputElement ? el : null
  }

  #session: LanguageModelSession | undefined

  #debounceTimer: ReturnType<typeof setTimeout> | undefined

  connectedCallback(): void {
    this.target?.setAttribute('autocomplete', 'off')
    this.target?.addEventListener('focus', this.#onFocus, { once: true })
    this.target?.addEventListener('input', this.#onInput)
    this.target?.addEventListener('keydown', this.#onKeydownListener)
    this.target?.addEventListener('blur', this.#onBlur)
    document.addEventListener('submit', this.#onDocumentSubmit)
    this.addEventListener('query-shaper-suggestions', this.#onSuggestionsEvent)
  }

  #onFocus = (): void => {
    void this.#ensureSession()
  }

  #onInput = (): void => {
    this.#scheduleGeneration()
  }

  #onKeydownListener = (e: Event): void => {
    this.#onKeydown(e as KeyboardEvent)
  }

  #onBlur = (): void => {
    this.#renderSuggestions([])
  }

  #onSuggestionsEvent = (e: Event): void => {
    this.#renderSuggestions((e as CustomEvent).detail.suggestions as Suggestion[])
  }

  #currentSuggestions: Suggestion[] = []
  #activeIndex = -1

  #renderSuggestions(suggestions: Suggestion[]): void {
    if (this.hasAttribute('headless')) return
    const byKind = new Map<string, Suggestion[]>()
    for (const suggestion of suggestions) {
      const bucket = byKind.get(suggestion.kind)
      if (bucket) bucket.push(suggestion)
      else byKind.set(suggestion.kind, [suggestion])
    }
    const grouped = KIND_ORDER.flatMap((kind) => byKind.get(kind) ?? [])
    this.#currentSuggestions = grouped
    this.#activeIndex = -1
    this.target?.setAttribute('role', 'combobox')
    this.target?.setAttribute('aria-expanded', grouped.length > 0 ? 'true' : 'false')
    this.target?.removeAttribute('aria-activedescendant')

    const root = this.#listboxContainer
    root.innerHTML = ''
    if (grouped.length === 0) {
      this.target?.removeAttribute('aria-controls')
      return
    }
    const list = document.createElement('ul')
    list.id = 'query-shaper-listbox'
    list.setAttribute('part', 'listbox')
    list.setAttribute('role', 'listbox')
    list.addEventListener('mousedown', (e) => e.preventDefault())
    this.target?.setAttribute('aria-controls', list.id)
    let index = 0
    for (const kind of KIND_ORDER) {
      const kindSuggestions = byKind.get(kind)
      if (!kindSuggestions || kindSuggestions.length === 0) continue
      const group = document.createElement('li')
      group.setAttribute('part', 'option-group')
      group.setAttribute('data-kind', kind)
      const groupList = document.createElement('ul')
      for (const suggestion of kindSuggestions) {
        const option = document.createElement('li')
        option.id = `query-shaper-option-${index}`
        option.setAttribute('part', 'option')
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', 'false')
        option.textContent = suggestion.text
        option.addEventListener('click', () => this.accept(suggestion))
        groupList.appendChild(option)
        index += 1
      }
      group.appendChild(groupList)
      list.appendChild(group)
    }
    root.appendChild(list)
  }

  #onKeydown(e: KeyboardEvent): void {
    if (this.#currentSuggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      this.#setActiveIndex(Math.min(this.#activeIndex + 1, this.#currentSuggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      this.#setActiveIndex(Math.max(this.#activeIndex - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const active = this.#currentSuggestions[this.#activeIndex]
      if (active) this.accept(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      this.#renderSuggestions([])
    }
  }

  #setActiveIndex(index: number): void {
    this.#activeIndex = index
    const options = this.#listboxContainer.querySelectorAll('[role="option"]')
    options.forEach((option, i) => {
      option.setAttribute('aria-selected', i === index ? 'true' : 'false')
    })
    const active = options[index]
    if (active) this.target?.setAttribute('aria-activedescendant', active.id)
  }

  disconnectedCallback(): void {
    this.target?.removeEventListener('focus', this.#onFocus)
    this.target?.removeEventListener('input', this.#onInput)
    this.target?.removeEventListener('keydown', this.#onKeydownListener)
    this.target?.removeEventListener('blur', this.#onBlur)
    document.removeEventListener('submit', this.#onDocumentSubmit)
    this.removeEventListener('query-shaper-suggestions', this.#onSuggestionsEvent)
    this.#session?.destroy()
    this.#session = undefined
  }

  #onDocumentSubmit = (e: Event): void => {
    if (this.target && e.target === this.target.form) {
      this.#recordHistory(this.target.value)
    }
  }

  #scheduleGeneration(): void {
    clearTimeout(this.#debounceTimer)
    this.#debounceTimer = setTimeout(() => {
      void this.#generate()
    }, DEBOUNCE_MS)
  }

  async #generate(): Promise<void> {
    try {
      await this.#generateInner()
    } catch (error) {
      this.dispatchEvent(new CustomEvent('query-shaper-error', { detail: { error, phase: 'generate' } }))
    }
  }

  async #generateInner(): Promise<void> {
    if (!this.#session) return
    const searchText = this.target?.value ?? ''
    if (searchText.trim().length === 0) {
      this.dispatchEvent(new CustomEvent('query-shaper-suggestions', { detail: { suggestions: [] } }))
      return
    }
    let history = this.#readHistory()
    let raw: string
    for (;;) {
      try {
        raw = await this.#session.prompt(this.#buildPrompt(searchText, history), {
          responseConstraint: SUGGESTIONS_RESPONSE_SCHEMA,
        })
        break
      } catch (err) {
        const isQuotaExceeded = err instanceof Error && err.name === 'QuotaExceededError'
        if (isQuotaExceeded && history.length > 0) {
          history = history.slice(1)
          continue
        }
        throw err
      }
    }
    const parsed = JSON.parse(raw) as { suggestions: RawSuggestion[] }
    const allowExpression = this.fields !== undefined
    const maxSuggestions = Number(this.getAttribute('max-suggestions') ?? Infinity)
    const kindCounts: Record<string, number> = {}
    const suggestions = parsed.suggestions
      .filter((s) => allowExpression || s.kind !== 'expression')
      .filter((s) => {
        const count = (kindCounts[s.kind] ?? 0) + 1
        kindCounts[s.kind] = count
        return count <= (DEFAULT_KIND_CAPS[s.kind] ?? Infinity)
      })
      .slice(0, maxSuggestions)
      .map((s) => this.#toSuggestion(s))
    this.dispatchEvent(new CustomEvent('query-shaper-suggestions', { detail: { suggestions } }))
  }

  #buildPrompt(searchText: string, history: string[]): string {
    const fields = this.fields
    const fieldsDescription = fields === undefined ? null : Array.isArray(fields) ? JSON.stringify(fields) : fields
    const lines = []
    if (fieldsDescription !== null) {
      lines.push(`Available fields: ${fieldsDescription}`)
      const format = this.format
      lines.push(`Format: ${typeof format === 'function' ? 'custom' : format}`)
    }
    if (history.length > 0) {
      lines.push(`History: ${history.join(', ')}`)
    }
    lines.push(`Search text: ${searchText}`)
    return lines.join('\n')
  }

  #toSuggestion(raw: RawSuggestion): Suggestion {
    if (raw.kind === 'expression') {
      return { kind: 'expression', fields: raw.fields, text: this.#renderFormat(raw.fields) }
    }
    return raw
  }

  #renderFormat(fields: FieldValue[]): string {
    const format = this.format
    if (typeof format === 'function') return format(fields)
    if (format === 'url-params') {
      return new URLSearchParams(fields.map((f) => [f.field ?? 'q', f.value] as [string, string])).toString()
    }
    const token = (f: FieldValue) => (f.field ? `${f.field}:${f.value}` : f.value)
    if (format === 'simple-query-string') {
      return fields
        .map((f) => `${f.operator === '+' || f.operator === '-' ? f.operator : ''}${token(f)}`)
        .join(' ')
    }
    return fields.map((f, i) => (i === 0 || !f.operator ? token(f) : `${f.operator} ${token(f)}`)).join(' ')
  }

  accept(suggestion: Suggestion): void {
    const action = this.getAttribute('action') ?? 'fill'
    let url: string | undefined
    if (action === 'opensearch') {
      const template = this.getAttribute('template')
      if (template) {
        url = template.replace('{searchTerms}', encodeURIComponent(suggestion.text))
        window.location.href = url
      }
    } else {
      if (this.target) this.target.value = suggestion.text
      if (action === 'submit') {
        this.target?.form?.requestSubmit()
      }
    }
    this.dispatchEvent(new CustomEvent('query-shaper-accept', { detail: { suggestion, action, url } }))
    // A native form submit records History itself (see #onDocumentSubmit), avoiding a
    // double-count — but only if there's actually a form to fire that submit event.
    if (action !== 'submit' || !this.target?.form) {
      this.#recordHistory(suggestion.text)
    }
  }

  #historyKey(): string {
    return `query-shaper:history:${this.getAttribute('history-key') ?? this.target?.id ?? ''}`
  }

  #maxHistory(): number {
    return Number(this.getAttribute('max-history') ?? 10)
  }

  #readHistory(): string[] {
    const max = this.#maxHistory()
    if (max <= 0) return []
    const raw = localStorage.getItem(this.#historyKey())
    const entries: string[] = raw ? JSON.parse(raw) : []
    return entries.slice(-max)
  }

  #recordHistory(text: string): void {
    const key = this.#historyKey()
    const max = this.#maxHistory()
    if (max <= 0) {
      localStorage.removeItem(key)
      return
    }
    const raw = localStorage.getItem(key)
    const entries: string[] = raw ? JSON.parse(raw) : []
    entries.push(text)
    localStorage.setItem(key, JSON.stringify(entries.slice(-max)))
  }

  async #ensureSession(): Promise<void> {
    if (this.#session) return
    const LM = (globalThis as { LanguageModel?: LanguageModelAPI }).LanguageModel
    if (!LM) {
      this.#emitStatus('unavailable')
      return
    }
    const availability = await LM.availability()
    this.#emitStatus(availability)
    if (availability === 'available') {
      this.#session = await this.#createSession(LM)
    }
  }

  async #createSession(LM: LanguageModelAPI): Promise<LanguageModelSession> {
    if (!sharedBaseSession) {
      sharedBaseSession = LM.create()
    }
    const base = await sharedBaseSession
    return base.clone()
  }

  #emitStatus(status: LanguageModelAvailability): void {
    this.dispatchEvent(new CustomEvent('query-shaper-status', { detail: { status } }))
    if (status === 'downloadable') {
      this.#renderDownloadPrompt()
    }
  }

  #renderDownloadPrompt(): void {
    if (this.hasAttribute('headless')) return
    if (localStorage.getItem(DOWNLOAD_PROMPT_DISMISSED_KEY) === 'true') return
    const root = this.#downloadPromptContainer
    root.innerHTML = ''

    const prompt = document.createElement('div')
    prompt.setAttribute('part', 'download-prompt')
    prompt.textContent = 'Enable client-side search enhancement? '

    const enableButton = document.createElement('button')
    enableButton.setAttribute('part', 'download-enable')
    enableButton.textContent = 'Enable'
    enableButton.addEventListener('click', () => void this.#enableDownload())

    const dismissButton = document.createElement('button')
    dismissButton.setAttribute('part', 'download-dismiss')
    dismissButton.textContent = 'Dismiss'
    dismissButton.addEventListener('click', () => {
      localStorage.setItem(DOWNLOAD_PROMPT_DISMISSED_KEY, 'true')
      prompt.remove()
    })

    prompt.appendChild(enableButton)
    prompt.appendChild(dismissButton)
    root.appendChild(prompt)
  }

  async #enableDownload(): Promise<void> {
    const LM = (globalThis as { LanguageModel?: LanguageModelAPI }).LanguageModel
    if (!LM) return
    this.#session = await this.#createSession(LM)
    this.#downloadPromptContainer.innerHTML = ''
  }
}

if (!customElements.get(QueryShaper.tagName)) {
  customElements.define(QueryShaper.tagName, QueryShaper)
}
