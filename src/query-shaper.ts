export type FieldDescriptor = {
  name: string
  type?: 'text' | 'number' | 'date'
  aliases?: string[]
  description?: string
}

export type Fields = string | FieldDescriptor[]

export type FieldValue = { field: string; value: string; operator?: string }
export type FormatPreset = 'lucene' | 'url-params'
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
  | { kind: 'structured-query'; fields: FieldValue[] }

export type Suggestion =
  | { kind: 'correction'; text: string }
  | { kind: 'expansion'; text: string }
  | { kind: 'structured-query'; text: string; fields: FieldValue[] }

const DEBOUNCE_MS = 400

const DEFAULT_KIND_CAPS: Record<string, number> = {
  correction: 1,
  expansion: 2,
  'structured-query': 3,
}

const SUGGESTIONS_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['correction', 'expansion', 'structured-query'] },
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
              required: ['field', 'value'],
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
    if (attr === 'lucene' || attr === 'url-params') return attr
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
    this.target?.addEventListener(
      'focus',
      () => {
        void this.#ensureSession()
      },
      { once: true },
    )
    this.target?.addEventListener('input', () => this.#scheduleGeneration())
    document.addEventListener('submit', this.#onDocumentSubmit)
  }

  disconnectedCallback(): void {
    document.removeEventListener('submit', this.#onDocumentSubmit)
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
    const allowStructuredQuery = this.fields !== undefined
    const maxSuggestions = Number(this.getAttribute('max-suggestions') ?? Infinity)
    const kindCounts: Record<string, number> = {}
    const suggestions = parsed.suggestions
      .filter((s) => allowStructuredQuery || s.kind !== 'structured-query')
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
    if (raw.kind === 'structured-query') {
      return { kind: 'structured-query', fields: raw.fields, text: this.#renderFormat(raw.fields) }
    }
    return raw
  }

  #renderFormat(fields: FieldValue[]): string {
    const format = this.format
    if (typeof format === 'function') return format(fields)
    if (format === 'url-params') {
      return new URLSearchParams(fields.map((f) => [f.field, f.value] as [string, string])).toString()
    }
    return fields
      .map((f, i) => (i === 0 || !f.operator ? `${f.field}:${f.value}` : `${f.operator} ${f.field}:${f.value}`))
      .join(' ')
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
      if (!sharedBaseSession) {
        sharedBaseSession = LM.create()
      }
      const base = await sharedBaseSession
      this.#session = await base.clone()
    }
  }

  #emitStatus(status: LanguageModelAvailability): void {
    this.dispatchEvent(new CustomEvent('query-shaper-status', { detail: { status } }))
  }
}

if (!customElements.get(QueryShaper.tagName)) {
  customElements.define(QueryShaper.tagName, QueryShaper)
}
