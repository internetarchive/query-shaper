import { describe, expect, it } from 'vitest'
import { extractFieldValues } from '../lucene-parser.js'

describe('extractFieldValues — opaque phrases (no query structure)', () => {
  it('treats a plain multi-word phrase with no colons/operators as one bare value', () => {
    expect(extractFieldValues('the eiffel tower in paris')).toEqual({
      fields: [{ value: 'the eiffel tower in paris' }],
      hasFieldReference: false,
    })
  })

  it('treats a single word as one bare value', () => {
    expect(extractFieldValues('paris')).toEqual({ fields: [{ value: 'paris' }], hasFieldReference: false })
  })

  it('strips a single pair of enclosing quotes from an otherwise-plain phrase', () => {
    expect(extractFieldValues('"the eiffel tower in paris"')).toEqual({
      fields: [{ value: 'the eiffel tower in paris' }],
      hasFieldReference: false,
    })
  })
})

describe('extractFieldValues — core tuples (field:value, bare terms, AND/OR/+/-)', () => {
  it('parses a single field:value clause', () => {
    expect(extractFieldValues('year:2020')).toEqual({
      fields: [{ field: 'year', value: '2020' }],
      hasFieldReference: true,
    })
  })

  it('parses a quoted multi-word field value', () => {
    expect(extractFieldValues('title:"climate change"')).toEqual({
      fields: [{ field: 'title', value: 'climate change' }],
      hasFieldReference: true,
    })
  })

  it('joins a bare phrase and a field clause with an explicit AND', () => {
    expect(extractFieldValues('"climate change" AND year:2020')).toEqual({
      fields: [{ value: 'climate change' }, { field: 'year', value: '2020', operator: 'AND' }],
      hasFieldReference: true,
    })
  })

  it('joins clauses with OR', () => {
    expect(extractFieldValues('category:electronics OR category:gadgets')).toEqual({
      fields: [
        { field: 'category', value: 'electronics' },
        { field: 'category', value: 'gadgets', operator: 'OR' },
      ],
      hasFieldReference: true,
    })
  })

  it('treats an unquoted multi-word bare sequence as separate terms, same as real Lucene', () => {
    expect(extractFieldValues('climate change AND year:2020')).toEqual({
      fields: [
        { value: 'climate' },
        { value: 'change' },
        { field: 'year', value: '2020', operator: 'AND' },
      ],
      hasFieldReference: true,
    })
  })

  it('carries a leading + as a required modifier', () => {
    expect(extractFieldValues('+required optional')).toEqual({
      fields: [{ value: 'required', operator: '+' }, { value: 'optional' }],
      hasFieldReference: false,
    })
  })

  it('carries a leading - as an excluded modifier', () => {
    expect(extractFieldValues('electronics -refurbished')).toEqual({
      fields: [{ value: 'electronics' }, { value: 'refurbished', operator: '-' }],
      hasFieldReference: false,
    })
  })

  it('treats an implicit NOT the same as a - modifier', () => {
    expect(extractFieldValues('electronics NOT refurbished')).toEqual({
      fields: [{ value: 'electronics' }, { value: 'refurbished', operator: '-' }],
      hasFieldReference: false,
    })
  })

  it('leaves an already-unquoted single-word field value alone', () => {
    expect(extractFieldValues('category:electronics')).toEqual({
      fields: [{ field: 'category', value: 'electronics' }],
      hasFieldReference: true,
    })
  })
})

describe('extractFieldValues — downgrades (range, wildcard, fuzzy, boost)', () => {
  it('parses a range with an empty tuple result but still flags the field reference, when it is the only clause', () => {
    expect(extractFieldValues('year:[2020 TO 2023]')).toEqual({ fields: [], hasFieldReference: true })
  })

  it('parses an open-ended wildcard range the same way', () => {
    expect(extractFieldValues('price:[0 TO *]')).toEqual({ fields: [], hasFieldReference: true })
    expect(extractFieldValues('year:[* TO 2015]')).toEqual({ fields: [], hasFieldReference: true })
  })

  it('drops just the range condition, keeping the rest of the query', () => {
    expect(extractFieldValues('category:electronics AND year:[2020 TO 2023]')).toEqual({
      fields: [{ field: 'category', value: 'electronics' }],
      hasFieldReference: true,
    })
  })

  it('preserves a wildcard as literal characters in the value', () => {
    expect(extractFieldValues('category:electr*')).toEqual({
      fields: [{ field: 'category', value: 'electr*' }],
      hasFieldReference: true,
    })
  })

  it('strips a fuzzy suffix', () => {
    expect(extractFieldValues('category:electronics~ OR price:50')).toEqual({
      fields: [
        { field: 'category', value: 'electronics' },
        { field: 'price', value: '50', operator: 'OR' },
      ],
      hasFieldReference: true,
    })
  })

  it('strips a fuzzy suffix with an explicit edit distance', () => {
    expect(extractFieldValues('category:electronics~2')).toEqual({
      fields: [{ field: 'category', value: 'electronics' }],
      hasFieldReference: true,
    })
  })

  it('strips a boost suffix', () => {
    expect(extractFieldValues('title:"climate change"^2')).toEqual({
      fields: [{ field: 'title', value: 'climate change' }],
      hasFieldReference: true,
    })
  })
})

describe('extractFieldValues — groups', () => {
  it('flattens a single-level, single-operator field group', () => {
    expect(extractFieldValues('category:(electronics OR gadgets)')).toEqual({
      fields: [
        { field: 'category', value: 'electronics' },
        { field: 'category', value: 'gadgets', operator: 'OR' },
      ],
      hasFieldReference: true,
    })
  })

  it('flattens a single-level, single-operator bare group', () => {
    expect(extractFieldValues('(cats OR dogs) AND category:pets')).toEqual({
      fields: [
        { value: 'cats' },
        { value: 'dogs', operator: 'OR' },
        { field: 'category', value: 'pets', operator: 'AND' },
      ],
      hasFieldReference: true,
    })
  })

  it('flattens two independent single-level groups', () => {
    expect(extractFieldValues('(cats OR dogs) AND (birds OR fish)')).toEqual({
      fields: [
        { value: 'cats' },
        { value: 'dogs', operator: 'OR' },
        { value: 'birds', operator: 'AND' },
        { value: 'fish', operator: 'OR' },
      ],
      hasFieldReference: false,
    })
  })

  it('drops the whole suggestion for a group mixing AND and OR', () => {
    expect(extractFieldValues('(cats OR dogs AND birds)')).toBeNull()
  })

  it('drops the whole suggestion for a nested group', () => {
    expect(extractFieldValues('(cats OR (dogs AND birds))')).toBeNull()
  })
})

describe('extractFieldValues — malformed input', () => {
  it('drops a suggestion with an unterminated quote', () => {
    expect(extractFieldValues('title:"climate change')).toBeNull()
  })

  it('drops a suggestion with a dangling field and no value', () => {
    expect(extractFieldValues('category:electronics AND price:')).toBeNull()
  })

  it('drops a suggestion that is entirely just a dangling field with nothing else', () => {
    expect(extractFieldValues('author:')).toBeNull()
    expect(extractFieldValues('title: ')).toBeNull()
  })

  it('drops a suggestion with an unterminated range', () => {
    expect(extractFieldValues('year:[2020')).toBeNull()
  })

  it('drops a suggestion with an unbalanced paren', () => {
    expect(extractFieldValues('(cats OR dogs')).toBeNull()
  })
})
