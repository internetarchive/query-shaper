import type { FieldValue } from './query-shaper.js'

// Suggestions are always written by the model as a Lucene-style string, then converted
// into the FieldValue[] tuples query-shaper already knows how to render (see
// #renderFormat in query-shaper.ts) — see docs/adr (once written) for why. Plain
// corrections/completions/rewordings never contain any query structure, so they're
// detected up front and passed through as a single bare value rather than being
// (mis)parsed word-by-word — see the WRAPPED_IN_QUOTES/hasQueryStructure gate below.
//
// The grammar covered is a deliberately restricted subset of real Lucene syntax: bare
// terms, quoted phrases, field:value, AND/OR/NOT/+/-, ranges, single-level groups
// (including field-scoped groups), wildcards, fuzzy (~), and boost (^). Anything genuinely
// ambiguous or unrepresentable as a flat FieldValue[] (a syntax error, or a nested/
// mixed-operator group) causes the whole suggestion to be dropped (return null) rather
// than rendering something broken — a suggestion silently missing beats one that's wrong.

type Operator = 'AND' | 'OR'
type Modifier = '+' | '-'

type TermNode = { type: 'term'; field?: string; value: string; modifier?: Modifier; op?: Operator }
type RangeNode = { type: 'range'; field: string; modifier?: Modifier; op?: Operator }
type GroupNode = { type: 'group'; field?: string; modifier?: Modifier; op?: Operator; items: Node[] }
type Node = TermNode | RangeNode | GroupNode

const WRAPPED_IN_QUOTES = /^"([^"\\]|\\.)*"$/

function unwrapQuotes(text: string): string {
  return text.slice(1, -1).replace(/\\"/g, '"')
}

/** True if `text` contains no signal of real query structure — a field:value pair, a
 * boolean operator, a leading +/- modifier, or more than one quoted segment. */
function hasQueryStructure(text: string): boolean {
  if (/\bAND\b|\bOR\b|\bNOT\b/.test(text)) return true
  if (/(^|\s)[+-]\S/.test(text)) return true
  if (/[A-Za-z0-9_.]+:\S/.test(text)) return true
  // A dangling "field:" with nothing after it (the whole string, not just a substring) is
  // still a structure signal — it's a field reference the model failed to finish, not a
  // plain phrase that happens to contain a colon (e.g. a URL) — so it should go through
  // the real parser and get rejected there, not slip through as literal opaque text.
  if (/^[A-Za-z0-9_.]+:$/.test(text)) return true
  if ((text.match(/"/g) ?? []).length > 2) return true
  return false
}

// --- Tokenizer -------------------------------------------------------------

type Token =
  | { type: 'WORD'; value: string }
  | { type: 'STRING'; value: string }
  | { type: 'COLON' }
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }
  | { type: 'LBRACKET' }
  | { type: 'RBRACKET' }
  | { type: 'LBRACE' }
  | { type: 'RBRACE' }
  | { type: 'CARET' }
  | { type: 'TILDE' }
  | { type: 'MODIFIER'; value: Modifier }
  | { type: 'AND' }
  | { type: 'OR' }
  | { type: 'NOT' }
  | { type: 'TO' }

const RESERVED_CHARS = new Set([':', '(', ')', '[', ']', '{', '}', '"', '^', '~'])

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  let atClauseStart = true
  while (i < input.length) {
    const ch = input[i]
    if (ch === undefined) break
    if (/\s/.test(ch)) {
      i += 1
      atClauseStart = true
      continue
    }
    if (ch === '"') {
      const end = findStringEnd(input, i)
      if (end === -1) return null
      tokens.push({ type: 'STRING', value: input.slice(i + 1, end).replace(/\\"/g, '"') })
      i = end + 1
      atClauseStart = false
      continue
    }
    if (ch === ':') {
      tokens.push({ type: 'COLON' })
      i += 1
      atClauseStart = false
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'LPAREN' })
      i += 1
      atClauseStart = true
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN' })
      i += 1
      atClauseStart = false
      continue
    }
    if (ch === '[') {
      tokens.push({ type: 'LBRACKET' })
      i += 1
      atClauseStart = true
      continue
    }
    if (ch === ']') {
      tokens.push({ type: 'RBRACKET' })
      i += 1
      atClauseStart = false
      continue
    }
    if (ch === '{') {
      tokens.push({ type: 'LBRACE' })
      i += 1
      atClauseStart = true
      continue
    }
    if (ch === '}') {
      tokens.push({ type: 'RBRACE' })
      i += 1
      atClauseStart = false
      continue
    }
    if (ch === '^') {
      tokens.push({ type: 'CARET' })
      i += 1
      atClauseStart = false
      continue
    }
    if (ch === '~') {
      tokens.push({ type: 'TILDE' })
      i += 1
      atClauseStart = false
      continue
    }
    if ((ch === '+' || ch === '-') && atClauseStart) {
      tokens.push({ type: 'MODIFIER', value: ch })
      i += 1
      atClauseStart = false
      continue
    }
    const start = i
    while (i < input.length) {
      const c = input[i]
      if (c === undefined || /\s/.test(c) || RESERVED_CHARS.has(c)) break
      i += 1
    }
    const word = input.slice(start, i)
    if (word === 'AND') tokens.push({ type: 'AND' })
    else if (word === 'OR') tokens.push({ type: 'OR' })
    else if (word === 'NOT') tokens.push({ type: 'NOT' })
    else if (word === 'TO') tokens.push({ type: 'TO' })
    else tokens.push({ type: 'WORD', value: word })
    atClauseStart = false
  }
  return tokens
}

function findStringEnd(input: string, start: number): number {
  let i = start + 1
  while (i < input.length) {
    if (input[i] === '\\') {
      i += 2
      continue
    }
    if (input[i] === '"') return i
    i += 1
  }
  return -1
}

// --- Parser ------------------------------------------------------------------

class Cursor {
  constructor(
    private tokens: Token[],
    public pos = 0,
  ) {}
  peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset]
  }
  next(): Token | undefined {
    return this.tokens[this.pos++]
  }
  get done(): boolean {
    return this.pos >= this.tokens.length
  }
}

function parse(tokens: Token[]): Node[] | null {
  const cursor = new Cursor(tokens)
  const nodes = parseSequence(cursor)
  if (nodes === null || !cursor.done) return null
  return nodes
}

/** A top-level or grouped sequence of clauses joined by explicit or implicit AND/OR. */
function parseSequence(cursor: Cursor): Node[] | null {
  const nodes: Node[] = []
  for (;;) {
    const next = cursor.peek()
    if (next === undefined || next.type === 'RPAREN') break
    let op: Operator | undefined
    if (nodes.length > 0) {
      if (next.type === 'AND') {
        op = 'AND'
        cursor.next()
      } else if (next.type === 'OR') {
        op = 'OR'
        cursor.next()
      }
    }
    const node = parseClause(cursor)
    if (node === null) return null
    if (op) node.op = op
    nodes.push(node)
  }
  return nodes
}

function parseClause(cursor: Cursor): Node | null {
  let modifier: Modifier | undefined
  const maybeModifier = cursor.peek()
  if (maybeModifier?.type === 'MODIFIER') {
    modifier = maybeModifier.value
    cursor.next()
  } else if (maybeModifier?.type === 'NOT') {
    modifier = '-'
    cursor.next()
  }

  const token = cursor.next()
  if (token === undefined) return null

  if (token.type === 'LPAREN') {
    const items = parseSequence(cursor)
    if (items === null || items.length === 0) return null
    if (cursor.next()?.type !== 'RPAREN') return null
    return { type: 'group', modifier, items }
  }

  if (token.type === 'WORD' || token.type === 'STRING') {
    const isField = token.type === 'WORD' && cursor.peek()?.type === 'COLON'
    if (isField) {
      cursor.next() // consume COLON
      return parseFieldValue(cursor, token.value, modifier)
    }
    return applySuffixes({ type: 'term', value: token.value, modifier }, cursor)
  }

  return null
}

function parseFieldValue(cursor: Cursor, field: string, modifier: Modifier | undefined): Node | null {
  const token = cursor.peek()
  if (token === undefined) return null

  if (token.type === 'LBRACKET' || token.type === 'LBRACE') {
    cursor.next()
    const from = cursor.next()
    if (from === undefined || (from.type !== 'WORD' && from.type !== 'STRING')) return null
    if (cursor.next()?.type !== 'TO') return null
    const to = cursor.next()
    if (to === undefined || (to.type !== 'WORD' && to.type !== 'STRING')) return null
    const closing = cursor.next()
    if (closing === undefined || (closing.type !== 'RBRACKET' && closing.type !== 'RBRACE')) return null
    return { type: 'range', field, modifier }
  }

  if (token.type === 'LPAREN') {
    cursor.next()
    const items = parseSequence(cursor)
    if (items === null || items.length === 0) return null
    if (cursor.next()?.type !== 'RPAREN') return null
    return { type: 'group', field, modifier, items }
  }

  if (token.type === 'WORD' || token.type === 'STRING') {
    cursor.next()
    return applySuffixes({ type: 'term', field, value: token.value, modifier }, cursor)
  }

  return null
}

/** Consumes an optional ^boost and/or ~fuzzy suffix after a term — both are recognized
 * for round-tripping/validity but carry no meaning in a flat FieldValue tuple, so they're
 * simply dropped rather than stored. */
function applySuffixes(node: TermNode, cursor: Cursor): TermNode | null {
  for (;;) {
    const next = cursor.peek()
    if (next?.type === 'CARET') {
      cursor.next()
      const num = cursor.next()
      if (num === undefined || num.type !== 'WORD' || !/^\d+(\.\d+)?$/.test(num.value)) return null
      continue
    }
    if (next?.type === 'TILDE') {
      cursor.next()
      const maybeNum = cursor.peek()
      if (maybeNum?.type === 'WORD' && /^\d+$/.test(maybeNum.value)) cursor.next()
      continue
    }
    break
  }
  return node
}

// --- Flattening --------------------------------------------------------------

/** A group flattens safely into its parent's tuple list only if every one of its own
 * children uses the same operator (no mixing AND/OR within one group) and none of them
 * is itself a nested group — otherwise the boolean structure can't survive being
 * flattened into query-shaper's flat FieldValue[] shape, so the whole suggestion is
 * dropped rather than rendering something that silently changes meaning. */
function flattenGroup(group: GroupNode): FieldValue[] | null {
  const opsUsed = new Set(group.items.slice(1).map((n) => n.op ?? 'AND'))
  if (opsUsed.size > 1) return null

  const out: FieldValue[] = []
  for (const item of group.items) {
    if (item.type === 'group') return null // no nested groups
    if (item.type === 'range') continue // no flat representation; drop this one condition
    const field = group.field ?? item.field
    const value: FieldValue = { value: item.value }
    if (field) value.field = field
    if (item.modifier) value.operator = item.modifier
    else if (item.op) value.operator = item.op
    out.push(value)
  }
  return out.length > 0 ? out : null
}

function flatten(nodes: Node[]): FieldValue[] | null {
  const out: FieldValue[] = []
  for (const node of nodes) {
    if (node.type === 'range') continue // no flat representation; drop this one condition
    if (node.type === 'group') {
      const flattened = flattenGroup(node)
      if (flattened === null) return null
      for (const [i, item] of flattened.entries()) {
        out.push(i === 0 && node.op ? { ...item, operator: node.op } : item)
      }
      continue
    }
    const value: FieldValue = { value: node.value }
    if (node.field) value.field = node.field
    if (node.modifier) value.operator = node.modifier
    else if (node.op) value.operator = node.op
    out.push(value)
  }
  return out.length > 0 ? out : null
}

export function extractFieldValues(text: string): FieldValue[] | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null

  if (WRAPPED_IN_QUOTES.test(trimmed)) {
    return [{ value: unwrapQuotes(trimmed) }]
  }

  if (!hasQueryStructure(trimmed)) {
    return [{ value: trimmed }]
  }

  const tokens = tokenize(trimmed)
  if (tokens === null) return null
  const nodes = parse(tokens)
  if (nodes === null) return null
  return flatten(nodes)
}
