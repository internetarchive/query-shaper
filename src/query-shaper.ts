export type FieldDescriptor = {
  name: string
  type?: 'text' | 'number' | 'date'
  aliases?: string[]
  description?: string
}

export type Fields = string | FieldDescriptor[] | Record<string, FieldDescriptor[]>

export type FieldValue = { field?: string; value: string; operator?: string }
export type FormatPreset = 'lucene' | 'url-params' | 'simple-query-string' | 'sql' | 'rest-api'
export type FormatRenderer = (fields: FieldValue[]) => string
export type Format = FormatPreset | FormatRenderer

export type LanguageModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

export type LanguageModelSession = {
  clone(): Promise<LanguageModelSession>
  destroy(): void
  append(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Promise<void>
  prompt(input: string, options?: { responseConstraint?: unknown; signal?: AbortSignal }): Promise<string>
}

export type LanguageModelAPI = {
  availability(options?: unknown): Promise<LanguageModelAvailability>
  create(options?: unknown): Promise<LanguageModelSession>
}

export type RawSuggestion =
  | { kind: 'correction'; text: string }
  | { kind: 'expansion'; text: string }
  | { kind: 'expression'; fields?: FieldValue[]; text?: string; resource?: string }

export type Suggestion =
  | { kind: 'correction'; text: string }
  | { kind: 'expansion'; text: string }
  | { kind: 'expression'; text: string; fields?: FieldValue[]; resource?: string }

export type HistoryEntry = {
  searchText: string
  suggestion: string
  kind: Suggestion['kind'] | 'submit'
  timestamp: number
}

const DEBOUNCE_MS = 400
const DOWNLOAD_PROMPT_DISMISSED_KEY = 'query-shaper:download-prompt-dismissed'
const MAX_UNKNOWN_ERROR_RETRIES = 2

const KIND_CONFIG = [
  { kind: 'correction', defaultCap: 1 },
  { kind: 'expansion', defaultCap: 2 },
  { kind: 'expression', defaultCap: 3 },
] as const

const KIND_ORDER = KIND_CONFIG.map((k) => k.kind)
const DEFAULT_KIND_CAPS: Record<string, number> = Object.fromEntries(
  KIND_CONFIG.map((k) => [k.kind, k.defaultCap]),
)

const GENERIC_INSTRUCTION =
  'Suggest improvements to the search text given in each prompt: up to 1 correction (only if there is a likely ' +
  'typo or misspelling), up to 2 expansions (related terms, synonyms, or alternate phrasings), and — if available ' +
  'fields are described for you — up to 3 expressions (fielded/boolean reformulations using those fields). ' +
  'Return each as its own separate item in the suggestions array — never merge multiple kinds into one item, and ' +
  'never invent extra properties beyond the ones described.'

const SUPPORTED_MODEL_LANGUAGES = ['de', 'en', 'es', 'fr', 'ja']

function detectModelLanguage(): string {
  const lang = document.documentElement.lang.split('-')[0]?.toLowerCase()
  return lang && SUPPORTED_MODEL_LANGUAGES.includes(lang) ? lang : 'en'
}

function languageModelOptions(): {
  expectedInputs: Array<{ type: 'text'; languages: string[] }>
  expectedOutputs: Array<{ type: 'text'; languages: string[] }>
} {
  const languages = [detectModelLanguage()]
  return {
    expectedInputs: [{ type: 'text', languages }],
    expectedOutputs: [{ type: 'text', languages }],
  }
}

function quoteMultiWord(value: string): string {
  const alreadyQuoted = value.length > 1 && value.startsWith('"') && value.endsWith('"')
  if (alreadyQuoted) return value
  return /\s/.test(value) ? `"${value}"` : value
}

function isFileResource(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed.includes('(') && trimmed.includes(')')) return true
  if (/^['"]/.test(trimmed)) return true
  if (/\.(csv|tsv|parquet|json|ndjson|xlsx)\b/i.test(trimmed)) return true
  if (/^\w+:\/\//.test(trimmed)) return true
  if (trimmed.includes('/')) return true
  return false
}

function describeResources(resources: Record<string, FieldDescriptor[]>): string {
  const tables: string[] = []
  const files: string[] = []
  for (const [name, descriptors] of Object.entries(resources)) {
    const columns = descriptors.map((d) => d.name).join(', ')
    const line = `- ${name}(${columns})`
    if (isFileResource(name)) files.push(line)
    else tables.push(line)
  }
  const lines: string[] = []
  if (tables.length > 0) {
    lines.push('Available tables:', ...tables)
  }
  if (files.length > 0) {
    lines.push('Available files (DuckDB can query these directly — local or remote):', ...files)
  }
  return lines.join('\n')
}

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
  [part="download-prompt"], [part="downloading-notice"] {
    background: var(--query-shaper-background, #fff);
    color: var(--query-shaper-color, #111);
    padding: var(--query-shaper-option-padding, 0.5em 0.75em);
  }
  [part="output"]:empty {
    display: none;
  }
  [part="output"] {
    display: block;
    background: var(--query-shaper-background, #fff);
    color: var(--query-shaper-color, #111);
    padding: var(--query-shaper-option-padding, 0.5em 0.75em);
    white-space: pre-wrap;
  }
`

function buildSuggestionsResponseSchema(isSql: boolean) {
  return {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        description: 'The list of Suggestions to offer, already sorted by relevance.',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['correction', 'expansion', 'expression'],
              description:
                'correction: fixes a likely typo or misspelling in the Search Text, keeping its meaning intact. ' +
                'expansion: broadens the Search Text with related terms, synonyms, or alternate phrasings. ' +
                'expression: reformulates the Search Text as a fielded and/or boolean query using the Available Fields below.',
            },
            text: {
              type: 'string',
              description:
                'For correction/expansion: the corrected or broadened search text, in the same language and style as the input. ' +
                'For expression: the fully rendered query text.',
            },
            resource: {
              type: 'string',
              description:
                'Only for an expression kind under a REST-API format: the endpoint this expression targets. Omit otherwise.',
            },
            fields: {
              type: 'array',
              description:
                'Only for an expression kind: EVERY field/value/operator tuple the query text was built from, ' +
                'all in this one array — never invent a second array or a differently-named property for more of them.',
              items: {
                type: 'object',
                properties: {
                  field: {
                    type: 'string',
                    description: 'The Available Field this value applies to. Omit for a bare, unscoped term.',
                  },
                  value: { type: 'string', description: 'The term or field value.' },
                  operator: {
                    type: 'string',
                    description: 'A format-specific operator, e.g. AND/OR, or +/-. Omit when not applicable.',
                  },
                },
                required: ['value'],
                additionalProperties: false,
              },
            },
          },
          required: isSql ? ['kind', 'text'] : ['kind'],
          additionalProperties: false,
        },
      },
    },
    required: ['suggestions'],
    additionalProperties: false,
  }
}

let sharedBaseSession: Promise<LanguageModelSession> | null = null

export function __resetSharedSessionForTests(): void {
  sharedBaseSession = null
}

export class QueryShaper extends HTMLElement {
  static readonly tagName = 'query-shaper'

  #listboxContainer: HTMLDivElement
  #downloadPromptContainer: HTMLDivElement
  #defaultOutput: HTMLOutputElement

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
    this.#defaultOutput = document.createElement('output')
    this.#defaultOutput.setAttribute('part', 'output')
    popup.appendChild(this.#defaultOutput)
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
    if (
      attr === 'lucene' ||
      attr === 'url-params' ||
      attr === 'simple-query-string' ||
      attr === 'sql' ||
      attr === 'rest-api'
    )
      return attr
    return 'lucene'
  }

  set format(value: Format) {
    this.#formatOverride = value
    this.#hasFormatOverride = true
  }

  #baseOverride: string | undefined
  #hasBaseOverride = false

  get base(): string {
    const raw = this.#hasBaseOverride ? this.#baseOverride : this.getAttribute('base')
    if (raw !== null && raw !== undefined) return new URL(raw, document.baseURI).toString()
    const url = new URL(document.baseURI)
    url.search = ''
    url.hash = ''
    return url.toString()
  }

  set base(value: string) {
    this.#baseOverride = value
    this.#hasBaseOverride = true
  }

  #hasBase(): boolean {
    return this.#hasBaseOverride || this.getAttribute('base') !== null
  }

  get target(): HTMLInputElement | HTMLTextAreaElement | null {
    const forId = this.getAttribute('for')
    if (!forId) return null
    const el = document.getElementById(forId)
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null
  }

  #session: LanguageModelSession | undefined

  #debounceTimer: ReturnType<typeof setTimeout> | undefined

  connectedCallback(): void {
    this.target?.setAttribute('autocomplete', 'off')
    this.target?.addEventListener('focus', this.#onFocus)
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
      const pending = this.#pendingHistoryContext
      this.#pendingHistoryContext = undefined
      if (pending) {
        this.#recordHistory(pending.searchText, this.target.value, pending.kind)
      } else {
        // A plain, accept-independent submit — the user typed and submitted directly,
        // with no distinct "original text" vs "accepted suggestion" to tell apart.
        this.#recordHistory(this.target.value, this.target.value, 'submit')
      }
    }
  }

  #scheduleGeneration(): void {
    clearTimeout(this.#debounceTimer)
    this.#debounceTimer = setTimeout(() => {
      void this.#generate()
    }, DEBOUNCE_MS)
  }

  #generationId = 0

  async #generate(): Promise<void> {
    const id = ++this.#generationId
    try {
      await this.#generateInner(id)
    } catch (error) {
      if (id !== this.#generationId) return
      this.dispatchEvent(new CustomEvent('query-shaper-error', { detail: { error, phase: 'generate' } }))
    }
  }

  #lastRequestedText: string | undefined
  #abortController: AbortController | undefined

  async #generateInner(id: number): Promise<void> {
    if (!this.#session) return
    const searchText = this.target?.value ?? ''
    const trimmed = searchText.trim()
    if (trimmed.length === 0) {
      this.#lastRequestedText = undefined
      this.#abortController?.abort()
      this.#abortController = undefined
      if (id !== this.#generationId) return
      this.dispatchEvent(new CustomEvent('query-shaper-suggestions', { detail: { suggestions: [] } }))
      return
    }
    // A pause that only added/removed leading/trailing whitespace isn't a meaningfully new
    // query — skip it rather than burning another on-device call and possibly aborting a
    // perfectly relevant in-flight one for no reason.
    if (trimmed === this.#lastRequestedText) return
    this.#lastRequestedText = trimmed
    await this.#ensureFieldsPrimed()
    if (!this.#session) return
    this.#abortController?.abort()
    const controller = new AbortController()
    this.#abortController = controller
    let history = this.#readHistory()
    let raw: string
    let unknownErrorRetries = 0
    const child = await this.#session.clone()
    try {
      for (;;) {
        try {
          raw = await child.prompt(this.#buildQueryPrompt(searchText, history), {
            responseConstraint: buildSuggestionsResponseSchema(this.format === 'sql'),
            signal: controller.signal,
          })
          break
        } catch (err) {
          const isQuotaExceeded = err instanceof Error && err.name === 'QuotaExceededError'
          if (isQuotaExceeded && history.length > 0) {
            history = history.slice(1)
            continue
          }
          const isUnknownError = err instanceof Error && err.name === 'UnknownError'
          if (isUnknownError && unknownErrorRetries < MAX_UNKNOWN_ERROR_RETRIES) {
            unknownErrorRetries += 1
            continue
          }
          throw err
        }
      }
    } finally {
      child.destroy()
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
      .filter((s): s is Suggestion => s !== null)
      .filter((s) => s.text.trim() !== searchText.trim())
    if (id !== this.#generationId) return
    this.dispatchEvent(new CustomEvent('query-shaper-suggestions', { detail: { suggestions } }))
  }

  #buildQueryPrompt(searchText: string, history: HistoryEntry[]): string {
    const lines = []
    if (history.length > 0) {
      // Few-shot context: what the user typed before, and which kind of suggestion they
      // actually accepted for it — a clue to their intent, and to what style/kind of
      // suggestion has worked for them recently.
      lines.push('History (prior accepted suggestions, oldest first):')
      lines.push(...history.map((h) => `- "${h.searchText}" -> ${h.kind}: "${h.suggestion}"`))
    }
    lines.push(`Search text: ${searchText}`)
    return lines.join('\n')
  }

  #buildFieldsSection(): string | null {
    const fields = this.fields
    if (fields === undefined) return null
    if (this.format === 'sql') return this.#buildSqlFieldsSection(fields)
    if (this.format === 'rest-api') return this.#buildRestFieldsSection(fields)
    const fieldsDescription = typeof fields === 'string' ? fields : JSON.stringify(fields)
    const format = this.format
    return `Available fields: ${fieldsDescription}\nFormat: ${typeof format === 'function' ? 'custom' : format}`
  }

  #buildRestFieldsSection(fields: Fields): string {
    const lines: string[] = []
    const placeholderNote =
      'An endpoint may contain {name} placeholders; return a field/value pair whose field matches each {name} you need to fill.'
    if (typeof fields === 'string') {
      lines.push(`Available endpoints: ${fields}`)
      lines.push('Return the endpoint you chose as "resource".')
    } else if (Array.isArray(fields)) {
      const resource = this.getAttribute('resource')
      if (resource) {
        const columns = fields.map((f) => f.name).join(', ')
        lines.push(`Available endpoint: ${resource}(${columns})`)
      } else {
        lines.push(`Available fields: ${JSON.stringify(fields)}`)
      }
    } else {
      const entries = Object.entries(fields).map(
        ([resource, descriptors]) => `- ${resource}(${descriptors.map((d) => d.name).join(', ')})`,
      )
      lines.push('Available endpoints:', ...entries)
      lines.push('Return the endpoint you chose as "resource".')
    }
    lines.push(placeholderNote)
    return lines.join('\n')
  }

  #buildSqlFieldsSection(fields: Fields): string {
    const lines: string[] = []
    if (typeof fields === 'string') {
      lines.push(`Available fields: ${fields}`)
    } else if (Array.isArray(fields)) {
      const resource = this.getAttribute('resource')
      if (resource) {
        lines.push(describeResources({ [resource]: fields }))
      } else {
        lines.push(`Available fields: ${JSON.stringify(fields)}`)
      }
    } else {
      lines.push(describeResources(fields))
    }
    lines.push('Write SQL for DuckDB.')
    return lines.join('\n')
  }

  #toSuggestion(raw: RawSuggestion): Suggestion | null {
    if (raw.kind === 'expression') {
      if (this.format === 'sql') {
        return { kind: 'expression', text: raw.text ?? '' }
      }
      const fields = raw.fields ?? []
      if (this.format === 'rest-api') return this.#toRestSuggestion(raw, fields)
      if (fields.length === 0 && raw.text) {
        // The model wrote free text instead of decomposing into fields — a best-effort
        // fallback beats silently rendering an empty, invisible suggestion.
        return { kind: 'expression', text: raw.text }
      }
      return { kind: 'expression', fields, text: this.#renderFormat(fields) }
    }
    return raw
  }

  #toRestSuggestion(raw: RawSuggestion & { kind: 'expression' }, fields: FieldValue[]): Suggestion | null {
    const resourceAttr = this.getAttribute('resource')
    const resource = resourceAttr ?? raw.resource
    const rendered = this.#renderRestUrl(resource, fields)
    if (rendered === null) {
      this.dispatchEvent(
        new CustomEvent('query-shaper-error', {
          detail: {
            error: new Error(`Unresolved path parameter in resource "${resource}"`),
            phase: 'rest-path-substitution',
          },
        }),
      )
      return null
    }
    const modelResource = !resourceAttr && raw.resource ? raw.resource : undefined
    return modelResource
      ? { kind: 'expression', text: rendered.text, fields: rendered.fields, resource: modelResource }
      : { kind: 'expression', text: rendered.text, fields: rendered.fields }
  }

  #renderRestUrl(resource: string | undefined, fields: FieldValue[]): { text: string; fields: FieldValue[] } | null {
    const consumed = new Set<number>()
    let unresolved = false
    const path = (resource ?? '').replace(/\{([^}]+)\}/g, (match, name: string) => {
      const idx = fields.findIndex((f, i) => f.field === name && !consumed.has(i))
      const matched = fields[idx]
      if (idx === -1 || !matched) {
        unresolved = true
        return match
      }
      consumed.add(idx)
      return encodeURIComponent(matched.value)
    })
    if (unresolved) return null
    const remaining = fields.filter((_, i) => !consumed.has(i))
    const query =
      remaining.length > 0
        ? new URLSearchParams(remaining.map((f) => [f.field ?? 'q', f.value] as [string, string])).toString()
        : ''
    const joined = path ? this.#joinUrl(this.base, path) : this.base
    return { text: query ? `${joined}?${query}` : joined, fields: remaining }
  }

  #joinUrl(base: string, path: string): string {
    const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base
    const trimmedPath = path.startsWith('/') ? path.slice(1) : path
    return `${trimmedBase}/${trimmedPath}`
  }

  #renderFormat(fields: FieldValue[]): string {
    const format = this.format
    if (typeof format === 'function') return format(fields)
    if (format === 'url-params') {
      const query = new URLSearchParams(fields.map((f) => [f.field ?? 'q', f.value] as [string, string])).toString()
      return this.#hasBase() ? `${this.base}?${query}` : query
    }
    if (format === 'simple-query-string') {
      // Quoting means "exact phrase" here, for a bare term as much as a fielded one — never trust
      // the model to remember it itself, since that's proven unreliable in practice.
      const token = (f: FieldValue) =>
        f.field ? `${f.field}:${quoteMultiWord(f.value)}` : quoteMultiWord(f.value)
      return fields
        .map((f) => `${f.operator === '+' || f.operator === '-' ? f.operator : ''}${token(f)}`)
        .join(' ')
    }
    // Bare terms stay unquoted here — an unscoped multi-word term is normal, unquoted search-box
    // input; only a fielded value's multi-word phrase is ambiguous without quotes.
    const token = (f: FieldValue) => (f.field ? `${f.field}:${quoteMultiWord(f.value)}` : f.value)
    return fields.map((f, i) => (i === 0 || !f.operator ? token(f) : `${f.operator} ${token(f)}`)).join(' ')
  }

  #pendingHistoryContext: { searchText: string; kind: HistoryEntry['kind'] } | undefined

  accept(suggestion: Suggestion): void {
    const action = this.getAttribute('action') ?? 'fill'
    const searchText = this.target?.value ?? ''
    let url: string | undefined
    if (action === 'opensearch') {
      const template = this.getAttribute('template')
      if (template) {
        url = template.replace('{searchTerms}', encodeURIComponent(suggestion.text))
        window.location.href = url
      }
    } else if (action === 'none') {
      // no-op: the host handles everything via the query-shaper-accept event below
    } else {
      if (this.target) this.target.value = suggestion.text
      if (action === 'submit') {
        if (this.target?.form) {
          // Consumed by #onDocumentSubmit, which requestSubmit() fires synchronously
          // below — that's the only place with access to what actually got submitted.
          this.#pendingHistoryContext = { searchText, kind: suggestion.kind }
        }
        this.target?.form?.requestSubmit()
      } else if (action === 'output') {
        this.#writeToDestination(suggestion.text)
      }
    }
    this.dispatchEvent(new CustomEvent('query-shaper-accept', { detail: { suggestion, action, url } }))
    // A native form submit records History itself (see #onDocumentSubmit), avoiding a
    // double-count — but only if there's actually a form to fire that submit event.
    if (action !== 'submit' || !this.target?.form) {
      this.#recordHistory(searchText, suggestion.text, suggestion.kind)
    }
  }

  #writeToDestination(text: string): void {
    const selector = this.getAttribute('destination')
    const elements: Iterable<Element> = selector ? document.querySelectorAll(selector) : [this.#defaultOutput]
    for (const el of elements) {
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        el.value = text
      } else {
        el.textContent = text
      }
    }
  }

  #historyKey(): string {
    return `query-shaper:history:${this.getAttribute('history-key') ?? this.target?.id ?? ''}`
  }

  #maxHistory(): number {
    return Number(this.getAttribute('max-history') ?? 10)
  }

  #historyCache: HistoryEntry[] | undefined

  // Read on every debounced generation call — the hot path — so it's served from an
  // in-memory cache, primed once from localStorage on first access rather than on every
  // call. Writes (rare: only on Accept/submit) stay immediate below, keeping the cache
  // in sync without ever deferring persistence.
  #readHistory(): HistoryEntry[] {
    const max = this.#maxHistory()
    if (max <= 0) return []
    if (this.#historyCache === undefined) {
      const raw = localStorage.getItem(this.#historyKey())
      const entries: HistoryEntry[] = raw ? JSON.parse(raw) : []
      this.#historyCache = entries.slice(-max)
    }
    return this.#historyCache
  }

  #recordHistory(searchText: string, suggestion: string, kind: HistoryEntry['kind']): void {
    const key = this.#historyKey()
    const max = this.#maxHistory()
    if (max <= 0) {
      localStorage.removeItem(key)
      this.#historyCache = []
      return
    }
    // Re-read fresh from localStorage rather than trusting the cache, so a sibling
    // instance sharing this history-key (see the history-key attribute) is merged
    // with, not silently overwritten by, a stale in-memory copy.
    const raw = localStorage.getItem(key)
    const entries: HistoryEntry[] = raw ? JSON.parse(raw) : []
    entries.push({ searchText, suggestion, kind, timestamp: Date.now() })
    const trimmed = entries.slice(-max)
    localStorage.setItem(key, JSON.stringify(trimmed))
    this.#historyCache = trimmed
  }

  #sessionPromise: Promise<void> | undefined

  #ensureSession(): Promise<void> {
    if (this.#session) return Promise.resolve()
    if (!this.#sessionPromise) {
      this.#sessionPromise = this.#ensureSessionInner().finally(() => {
        this.#sessionPromise = undefined
      })
    }
    return this.#sessionPromise
  }

  async #ensureSessionInner(): Promise<void> {
    const LM = (globalThis as { LanguageModel?: LanguageModelAPI }).LanguageModel
    if (!LM) {
      this.#emitStatus('unavailable')
      return
    }
    const availability = await LM.availability(languageModelOptions())
    this.#emitStatus(availability)
    if (availability === 'available' || availability === 'downloading') {
      this.#session = await this.#createSession(LM)
      this.#downloadPromptContainer.innerHTML = ''
      if (availability === 'downloading') {
        this.#emitStatus('available')
      }
    }
  }

  #primedFieldsSnapshot: string | null | undefined

  async #createSession(LM: LanguageModelAPI): Promise<LanguageModelSession> {
    if (!sharedBaseSession) {
      sharedBaseSession = LM.create({
        ...languageModelOptions(),
        initialPrompts: [{ role: 'system', content: GENERIC_INSTRUCTION }],
      })
    }
    return this.#buildParentSession(await sharedBaseSession)
  }

  // Fields/Format only vary per instance when set imperatively — but #buildFieldsSection()
  // has no caching of its own, so an attribute change would otherwise be silently ignored
  // once Fields/Format are primed into the parent session rather than resent on every query.
  async #ensureFieldsPrimed(): Promise<void> {
    const currentFieldsContent = this.#buildFieldsSection()
    if (currentFieldsContent === this.#primedFieldsSnapshot) return
    if (!sharedBaseSession) return
    this.#session?.destroy()
    this.#session = await this.#buildParentSession(await sharedBaseSession)
  }

  async #buildParentSession(grandparent: LanguageModelSession): Promise<LanguageModelSession> {
    const fieldsContent = this.#buildFieldsSection()
    const parentSession = await grandparent.clone()
    if (fieldsContent !== null) {
      await parentSession.append([{ role: 'user', content: fieldsContent }])
    }
    this.#primedFieldsSnapshot = fieldsContent
    return parentSession
  }

  #emitStatus(status: LanguageModelAvailability): void {
    this.dispatchEvent(new CustomEvent('query-shaper-status', { detail: { status } }))
    if (status === 'downloadable') {
      this.#renderDownloadPrompt()
    } else if (status === 'downloading') {
      this.#renderDownloadingNotice()
    }
  }

  #renderDownloadingNotice(): void {
    if (this.hasAttribute('headless')) return
    const root = this.#downloadPromptContainer
    root.innerHTML = ''
    const notice = document.createElement('div')
    notice.setAttribute('part', 'downloading-notice')
    notice.textContent =
      "The AI model is downloading in the background — Suggestions will start to appear once it's ready."
    root.appendChild(notice)
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
