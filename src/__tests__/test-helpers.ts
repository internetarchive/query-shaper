import { vi } from 'vitest'
import { QueryShaper } from '../query-shaper.js'

export function mount(id = 'search') {
  const input = document.createElement('input')
  input.id = id
  document.body.appendChild(input)

  const shaper = new QueryShaper()
  shaper.setAttribute('for', id)
  document.body.appendChild(shaper)

  return { shaper, input }
}

export function mockLanguageModel(
  options: { availability?: string; promptResponse?: unknown; promptError?: Error } = {},
) {
  const { availability = 'available', promptResponse, promptError } = options
  // Three tiers: baseSession (shared "grandparent") -> instanceSession (per-instance
  // "parent", primed with Fields/Format via append()) -> clonedSession (disposable
  // per-query "child", the one actually prompted for a real response).
  const clonedSession = {
    clone: vi.fn(),
    destroy: vi.fn(),
    append: vi.fn().mockResolvedValue(undefined),
    prompt: promptError
      ? vi.fn().mockRejectedValue(promptError)
      : vi.fn().mockResolvedValue(JSON.stringify(promptResponse ?? { suggestions: [] })),
  }
  const instanceSession = {
    clone: vi.fn().mockResolvedValue(clonedSession),
    destroy: vi.fn(),
    append: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn(),
  }
  const baseSession = {
    clone: vi.fn().mockResolvedValue(instanceSession),
    destroy: vi.fn(),
    append: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn(),
  }
  return {
    availability: vi.fn().mockResolvedValue(availability),
    create: vi.fn().mockResolvedValue(baseSession),
    baseSession,
    instanceSession,
    clonedSession,
  }
}
