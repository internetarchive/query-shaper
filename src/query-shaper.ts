import { extractFieldValues, type ParsedSuggestion } from './lucene-parser.js'

export type FieldDescriptor = {
  name: string
  type?: 'text' | 'number' | 'date' | 'boolean'
  aliases?: string[]
  description?: string
}

export type Fields = string | FieldDescriptor[]

export type Example = { input: string; suggestions: string[] }
export type Examples = string | Example[]

export type FieldValue = { field?: string; value: string; operator?: string }
export type FormatPreset = 'lucene' | 'url-params' | 'simple-query-string'
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

export type Suggestion = string

export type HistoryEntry = {
  searchText: string
  suggestion: string
  timestamp: number
}

const DEBOUNCE_MS = 400
const DOWNLOAD_PROMPT_DISMISSED_KEY = 'query-shaper:download-prompt-dismissed'
const MAX_UNKNOWN_ERROR_RETRIES = 2
const DEFAULT_MAX_SUGGESTIONS = 5

const GENERIC_INSTRUCTION =
  'You are a keyword search assistant, not a chat assistant: every suggestion you return must read like ' +
  'something someone would type into a search box — short keywords or a phrase, never a descriptive sentence, ' +
  'an explanation, or a list, and no sentence-ending punctuation. Given the search text in each prompt, ' +
  `suggest up to ${DEFAULT_MAX_SUGGESTIONS} reasonable alternative or refined queries the user might actually ` +
  'want instead — these may fix a likely typo, complete an unfinished word or phrase, broaden with related ' +
  'terms or synonyms, or (when fields are described below) reformulate as a fielded/boolean query, in any ' +
  'mix, whichever are genuinely useful for this search text, most relevant first. Always write each ' +
  'suggestion as if it were a real Lucene query: a plain phrase for a simple rewording (e.g. "the eiffel ' +
  'tower in paris"), quoted for a multi-word phrase you mean as one unit — bare or after a field, same rule ' +
  'either way — field:value for a fielded condition using only the fields described below, AND/OR/+/- to ' +
  'combine conditions, and [X TO Y] for a range; never invent a field that isn\'t described. Never repeat a ' +
  'suggestion that is identical to the search text. Return each suggestion as its own separate string in the ' +
  'array — never combine more than one idea into a single string with a comma or "and".'

// Dev-only visibility into session lifecycle and generation timing — every call site is
// guarded by import.meta.env.DEV, a compile-time constant Vite replaces and then
// tree-shakes away entirely in a production build (verified: none of this, or its call
// sites, appear in dist/query-shaper.js).
function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.log('[query-shaper]', ...args)
}

async function devTimed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!import.meta.env.DEV) return fn()
  const start = performance.now()
  try {
    const result = await fn()
    devLog(`${label} — ${(performance.now() - start).toFixed(0)}ms`)
    return result
  } catch (err) {
    devLog(`${label} — ${(performance.now() - start).toFixed(0)}ms — failed:`, err)
    throw err
  }
}

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

function buildSuggestionsResponseSchema(maxSuggestions: number) {
  return {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        maxItems: maxSuggestions,
        description:
          `Up to ${maxSuggestions} reasonable alternative or refined queries for the given search text, each ` +
          'written as if it were a real Lucene query, most relevant first.',
        items: { type: 'string' },
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

  #examplesOverride: Examples | undefined
  #hasExamplesOverride = false

  get examples(): Examples | undefined {
    if (this.#hasExamplesOverride) return this.#examplesOverride
    const attr = this.getAttribute('examples')
    if (attr === null) return undefined
    try {
      return JSON.parse(attr)
    } catch {
      return attr
    }
  }

  set examples(value: Examples | undefined) {
    this.#examplesOverride = value
    this.#hasExamplesOverride = true
  }

  #notesOverride: string | undefined
  #hasNotesOverride = false

  get notes(): string | undefined {
    if (this.#hasNotesOverride) return this.#notesOverride
    return this.getAttribute('notes') ?? undefined
  }

  set notes(value: string | undefined) {
    this.#notesOverride = value
    this.#hasNotesOverride = true
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
    this.#currentSuggestions = suggestions
    this.#activeIndex = -1
    this.target?.setAttribute('role', 'combobox')
    this.target?.setAttribute('aria-expanded', suggestions.length > 0 ? 'true' : 'false')
    this.target?.removeAttribute('aria-activedescendant')

    const root = this.#listboxContainer
    root.innerHTML = ''
    if (suggestions.length === 0) {
      this.target?.removeAttribute('aria-controls')
      return
    }
    const list = document.createElement('ul')
    list.id = 'query-shaper-listbox'
    list.setAttribute('part', 'listbox')
    list.setAttribute('role', 'listbox')
    list.addEventListener('mousedown', (e) => e.preventDefault())
    this.target?.setAttribute('aria-controls', list.id)
    suggestions.forEach((suggestion, index) => {
      const option = document.createElement('li')
      option.id = `query-shaper-option-${index}`
      option.setAttribute('part', 'option')
      option.setAttribute('role', 'option')
      option.setAttribute('aria-selected', 'false')
      option.textContent = suggestion
      option.addEventListener('click', () => this.accept(suggestion))
      list.appendChild(option)
    })
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
      if (pending !== undefined) {
        this.#recordHistory(pending, this.target.value)
      } else {
        // A plain, accept-independent submit — the user typed and submitted directly,
        // with no distinct "original text" vs "accepted suggestion" to tell apart.
        this.#recordHistory(this.target.value, this.target.value)
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
      if (id !== this.#generationId) {
        devLog(`${this.#tag()} #${id} errored after being superseded, suppressing query-shaper-error:`, error)
        return
      }
      devLog(`${this.#tag()} #${id} emitting query-shaper-error:`, error)
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
      this.#abortController?.abort('search text cleared')
      this.#abortController = undefined
      if (id !== this.#generationId) return
      this.dispatchEvent(new CustomEvent('query-shaper-suggestions', { detail: { suggestions: [] } }))
      return
    }
    // A pause that only added/removed leading/trailing whitespace isn't a meaningfully new
    // query — skip it rather than burning another on-device call and possibly aborting a
    // perfectly relevant in-flight one for no reason.
    if (trimmed === this.#lastRequestedText) {
      devLog(`${this.#tag()} #${id} skipped — trimmed text unchanged`)
      return
    }
    this.#lastRequestedText = trimmed
    await this.#ensureFieldsPrimed()
    if (!this.#session) return
    if (this.#abortController) {
      devLog(`${this.#tag()} #${id} aborting a superseded in-flight generation`)
      this.#abortController.abort('superseded by a newer generation')
    }
    const controller = new AbortController()
    this.#abortController = controller
    let history = this.#readHistory()
    let raw: string
    let unknownErrorRetries = 0
    const maxSuggestions = Number(this.getAttribute('max-suggestions') ?? DEFAULT_MAX_SUGGESTIONS)
    devLog(`${this.#tag()} #${id} generating for "${trimmed}" (${history.length} History entries)`)
    const child = await this.#session.clone()
    try {
      for (;;) {
        try {
          const promptText = this.#buildQueryPrompt(searchText, history)
          devLog(`${this.#tag()} #${id} prompt text:`, promptText)
          raw = await devTimed(`${this.#tag()} #${id} prompt()`, () =>
            child.prompt(promptText, {
              responseConstraint: buildSuggestionsResponseSchema(maxSuggestions),
              signal: controller.signal,
            }),
          )
          break
        } catch (err) {
          const isQuotaExceeded = err instanceof Error && err.name === 'QuotaExceededError'
          if (isQuotaExceeded && history.length > 0) {
            devLog(`${this.#tag()} #${id} QuotaExceededError — trimming oldest History entry and retrying`)
            history = history.slice(1)
            continue
          }
          const isUnknownError = err instanceof Error && err.name === 'UnknownError'
          if (isUnknownError && unknownErrorRetries < MAX_UNKNOWN_ERROR_RETRIES) {
            unknownErrorRetries += 1
            devLog(`${this.#tag()} #${id} UnknownError — retry ${unknownErrorRetries}/${MAX_UNKNOWN_ERROR_RETRIES}`)
            continue
          }
          devLog(`${this.#tag()} #${id} prompt() failed:`, err)
          throw err
        }
      }
    } finally {
      child.destroy()
    }
    const parsed = JSON.parse(raw) as { suggestions: string[] }
    devLog(`${this.#tag()} #${id} raw suggestions from model:`, parsed.suggestions)
    const allowExpression = this.fields !== undefined
    // maxItems on the schema should already bound this, but never fully trust the model to
    // honor a structural constraint — enforce the real limit in code too.
    const suggestions = parsed.suggestions
      .map((s) => {
        const parsedFields = extractFieldValues(s)
        devLog(`${this.#tag()} #${id} parsed "${s}" ->`, parsedFields)
        return this.#renderSuggestion(s, parsedFields, allowExpression)
      })
      .filter((s): s is string => s !== null)
      .filter((s) => s.trim() !== searchText.trim())
      .slice(0, maxSuggestions)
    if (id !== this.#generationId) {
      devLog(`${this.#tag()} #${id} discarded — superseded by a newer generation`)
      return
    }
    devLog(`${this.#tag()} #${id} ${suggestions.length} suggestion(s):`, suggestions)
    this.dispatchEvent(new CustomEvent('query-shaper-suggestions', { detail: { suggestions } }))
  }

  #buildQueryPrompt(searchText: string, history: HistoryEntry[]): string {
    const lines = []
    if (history.length > 0) {
      // Few-shot context: what the user typed before, and what they ultimately accepted for
      // it — a clue to their intent and to what style of answer has worked for them recently.
      lines.push('History (prior accepted suggestions, oldest first):')
      lines.push(...history.map((h) => `- "${h.searchText}" -> "${h.suggestion}"`))
    }
    lines.push(`Search text: ${searchText}`)
    return lines.join('\n')
  }

  #buildFieldsSection(): string | null {
    const fields = this.fields
    const examples = this.examples
    const notes = this.notes
    if (fields === undefined && examples === undefined && notes === undefined) return null
    const lines: string[] = []
    if (fields !== undefined) {
      const fieldsDescription = typeof fields === 'string' ? fields : JSON.stringify(fields)
      lines.push(`Available fields: ${fieldsDescription}`)
    }
    if (examples !== undefined) {
      lines.push('Examples:')
      if (typeof examples === 'string') {
        lines.push(examples)
      } else {
        // Escape quotes already inside input/suggestion text before wrapping in our own —
        // a suggestion like `subject:"climate change"` would otherwise nest unescaped
        // quotes inside the wrapping quotes, ambiguous for the model to read back.
        const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`
        lines.push(
          ...examples.map((e) => `- ${quote(e.input)} -> ${e.suggestions.map(quote).join(', ')}`),
        )
      }
    }
    if (notes !== undefined) {
      lines.push(`Notes: ${notes}`)
    }
    return lines.join('\n')
  }

  // Every suggestion is always written by the model as a Lucene-style string (see
  // GENERIC_INSTRUCTION) and converted, by the caller, into the FieldValue[] tuples
  // #renderFormat already knows how to render — see lucene-parser.ts for the grammar
  // covered. `parsed` is null when `raw` failed to parse (genuinely malformed structured
  // query) — always dropped. A suggestion referencing a field despite none being declared
  // for this instance is also dropped. `parsed.fields` can legitimately be empty (e.g. a
  // suggestion that's entirely one range) — 'lucene' still renders that verbatim, since
  // the raw text is valid syntax with nothing to reconstruct; every other Format has
  // nothing left to render, so it's dropped there instead.
  #renderSuggestion(raw: string, parsed: ParsedSuggestion | null, allowExpression: boolean): string | null {
    if (parsed === null) return null
    if (!allowExpression && parsed.hasFieldReference) return null
    if (this.format === 'lucene') return raw.trim()
    if (parsed.fields.length === 0) return null
    return this.#renderFormat(parsed.fields)
  }

  // Only ever called for 'url-params'/'simple-query-string'/a custom FormatRenderer —
  // 'lucene' is handled by raw passthrough in #renderSuggestion above, since the model's
  // own Lucene-style text already needs no re-rendering into itself.
  #renderFormat(fields: FieldValue[]): string {
    const format = this.format
    if (typeof format === 'function') return format(fields)
    if (format === 'simple-query-string') {
      // Quoting means "exact phrase" here, for a bare term as much as a fielded one — never trust
      // the model to remember it itself, since that's proven unreliable in practice.
      const token = (f: FieldValue) =>
        f.field ? `${f.field}:${quoteMultiWord(f.value)}` : quoteMultiWord(f.value)
      return fields
        .map((f) => `${f.operator === '+' || f.operator === '-' ? f.operator : ''}${token(f)}`)
        .join(' ')
    }
    const query = new URLSearchParams(fields.map((f) => [f.field ?? 'q', f.value] as [string, string])).toString()
    return this.#hasBase() ? `${this.base}?${query}` : query
  }

  #pendingHistoryContext: string | undefined

  accept(suggestion: Suggestion): void {
    const action = this.getAttribute('action') ?? 'fill'
    const searchText = this.target?.value ?? ''
    devLog(`${this.#tag()} accept (${action}):`, suggestion)
    let url: string | undefined
    if (action === 'opensearch') {
      const template = this.getAttribute('template')
      if (template) {
        url = template.replace('{searchTerms}', encodeURIComponent(suggestion))
        window.location.href = url
      }
    } else if (action === 'none') {
      // no-op: the host handles everything via the query-shaper-accept event below
    } else {
      if (this.target) this.target.value = suggestion
      if (action === 'submit') {
        if (this.target?.form) {
          // Consumed by #onDocumentSubmit, which requestSubmit() fires synchronously
          // below — that's the only place with access to what actually got submitted.
          this.#pendingHistoryContext = searchText
        }
        this.target?.form?.requestSubmit()
      } else if (action === 'output') {
        this.#writeToDestination(suggestion)
      }
    }
    this.dispatchEvent(new CustomEvent('query-shaper-accept', { detail: { suggestion, action, url } }))
    // A native form submit records History itself (see #onDocumentSubmit), avoiding a
    // double-count — but only if there's actually a form to fire that submit event.
    if (action !== 'submit' || !this.target?.form) {
      this.#recordHistory(searchText, suggestion)
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

  #recordHistory(searchText: string, suggestion: string): void {
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
    entries.push({ searchText, suggestion, timestamp: Date.now() })
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

  #tag(): string {
    return `[${this.target?.id ?? '?'}]`
  }

  async #ensureSessionInner(): Promise<void> {
    const LM = (globalThis as { LanguageModel?: LanguageModelAPI }).LanguageModel
    if (!LM) {
      devLog(`${this.#tag()} no LanguageModel API present`)
      this.#emitStatus('unavailable')
      return
    }
    const availability = await devTimed(`${this.#tag()} availability()`, () =>
      LM.availability(languageModelOptions()),
    )
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
      devLog('creating shared grandparent session with system prompt:', GENERIC_INSTRUCTION)
      sharedBaseSession = devTimed('grandparent create()', () =>
        LM.create({
          ...languageModelOptions(),
          initialPrompts: [{ role: 'system', content: GENERIC_INSTRUCTION }],
        }),
      )
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
    devLog(`${this.#tag()} Fields/Format changed — rebuilding parent session`)
    this.#session?.destroy()
    this.#session = await this.#buildParentSession(await sharedBaseSession)
  }

  async #buildParentSession(grandparent: LanguageModelSession): Promise<LanguageModelSession> {
    const fieldsContent = this.#buildFieldsSection()
    const parentSession = await devTimed(`${this.#tag()} clone parent`, () => grandparent.clone())
    if (fieldsContent !== null) {
      devLog(`${this.#tag()} appending Fields/Format message:`, fieldsContent)
      await devTimed(`${this.#tag()} append Fields/Format`, () =>
        parentSession.append([{ role: 'user', content: fieldsContent }]),
      )
    }
    this.#primedFieldsSnapshot = fieldsContent
    return parentSession
  }

  #emitStatus(status: LanguageModelAvailability): void {
    devLog(`${this.#tag()} status: ${status}`)
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
