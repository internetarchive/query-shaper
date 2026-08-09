import { describe, expect, it } from 'vitest'
import { extractFieldValues } from '../lucene-parser.js'

describe('extractFieldValues — opaque phrases (no query structure)', () => {
  it('treats a plain multi-word phrase with no colons/operators as one bare value', () => {
    expect(extractFieldValues('the eiffel tower in paris')).toEqual([{ value: 'the eiffel tower in paris' }])
  })

  it('treats a single word as one bare value', () => {
    expect(extractFieldValues('paris')).toEqual([{ value: 'paris' }])
  })

  it('strips a single pair of enclosing quotes from an otherwise-plain phrase', () => {
    expect(extractFieldValues('"the eiffel tower in paris"')).toEqual([{ value: 'the eiffel tower in paris' }])
  })
})

describe('extractFieldValues — core tuples (field:value, bare terms, AND/OR/+/-)', () => {
  it('parses a single field:value clause', () => {
    expect(extractFieldValues('year:2020')).toEqual([{ field: 'year', value: '2020' }])
  })

  it('parses a quoted multi-word field value', () => {
    expect(extractFieldValues('title:"climate change"')).toEqual([{ field: 'title', value: 'climate change' }])
  })

  it('joins a bare phrase and a field clause with an explicit AND', () => {
    expect(extractFieldValues('"climate change" AND year:2020')).toEqual([
      { value: 'climate change' },
      { field: 'year', value: '2020', operator: 'AND' },
    ])
  })

  it('joins clauses with OR', () => {
    expect(extractFieldValues('category:electronics OR category:gadgets')).toEqual([
      { field: 'category', value: 'electronics' },
      { field: 'category', value: 'gadgets', operator: 'OR' },
    ])
  })

  it('treats an unquoted multi-word bare sequence as separate terms, same as real Lucene', () => {
    expect(extractFieldValues('climate change AND year:2020')).toEqual([
      { value: 'climate' },
      { value: 'change' },
      { field: 'year', value: '2020', operator: 'AND' },
    ])
  })

  it('carries a leading + as a required modifier', () => {
    expect(extractFieldValues('+required optional')).toEqual([
      { value: 'required', operator: '+' },
      { value: 'optional' },
    ])
  })

  it('carries a leading - as an excluded modifier', () => {
    expect(extractFieldValues('electronics -refurbished')).toEqual([
      { value: 'electronics' },
      { value: 'refurbished', operator: '-' },
    ])
  })

  it('treats an implicit NOT the same as a - modifier', () => {
    expect(extractFieldValues('electronics NOT refurbished')).toEqual([
      { value: 'electronics' },
      { value: 'refurbished', operator: '-' },
    ])
  })

  it('leaves an already-unquoted single-word field value alone', () => {
    expect(extractFieldValues('category:electronics')).toEqual([{ field: 'category', value: 'electronics' }])
  })
})

describe('extractFieldValues — downgrades (range, wildcard, fuzzy, boost)', () => {
  it('drops a range condition entirely when it is the only clause', () => {
    expect(extractFieldValues('year:[2020 TO 2023]')).toBeNull()
  })

  it('drops just the range condition, keeping the rest of the query', () => {
    expect(extractFieldValues('category:electronics AND year:[2020 TO 2023]')).toEqual([
      { field: 'category', value: 'electronics' },
    ])
  })

  it('preserves a wildcard as literal characters in the value', () => {
    expect(extractFieldValues('category:electr*')).toEqual([{ field: 'category', value: 'electr*' }])
  })

  it('strips a fuzzy suffix', () => {
    expect(extractFieldValues('category:electronics~ OR price:50')).toEqual([
      { field: 'category', value: 'electronics' },
      { field: 'price', value: '50', operator: 'OR' },
    ])
  })

  it('strips a fuzzy suffix with an explicit edit distance', () => {
    expect(extractFieldValues('category:electronics~2')).toEqual([{ field: 'category', value: 'electronics' }])
  })

  it('strips a boost suffix', () => {
    expect(extractFieldValues('title:"climate change"^2')).toEqual([{ field: 'title', value: 'climate change' }])
  })
})

describe('extractFieldValues — groups', () => {
  it('flattens a single-level, single-operator field group', () => {
    expect(extractFieldValues('category:(electronics OR gadgets)')).toEqual([
      { field: 'category', value: 'electronics' },
      { field: 'category', value: 'gadgets', operator: 'OR' },
    ])
  })

  it('flattens a single-level, single-operator bare group', () => {
    expect(extractFieldValues('(cats OR dogs) AND category:pets')).toEqual([
      { value: 'cats' },
      { value: 'dogs', operator: 'OR' },
      { field: 'category', value: 'pets', operator: 'AND' },
    ])
  })

  it('flattens two independent single-level groups', () => {
    expect(extractFieldValues('(cats OR dogs) AND (birds OR fish)')).toEqual([
      { value: 'cats' },
      { value: 'dogs', operator: 'OR' },
      { value: 'birds', operator: 'AND' },
      { value: 'fish', operator: 'OR' },
    ])
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
