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
  const clonedSession = {
    clone: vi.fn(),
    destroy: vi.fn(),
    prompt: promptError
      ? vi.fn().mockRejectedValue(promptError)
      : vi.fn().mockResolvedValue(JSON.stringify(promptResponse ?? { suggestions: [] })),
  }
  const baseSession = {
    clone: vi.fn().mockResolvedValue(clonedSession),
    destroy: vi.fn(),
    prompt: vi.fn(),
  }
  return {
    availability: vi.fn().mockResolvedValue(availability),
    create: vi.fn().mockResolvedValue(baseSession),
    baseSession,
    clonedSession,
  }
}
