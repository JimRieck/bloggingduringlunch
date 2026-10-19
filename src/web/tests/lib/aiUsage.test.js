import { describe, expect, it } from 'vitest'
import { aiFeatureLabel } from '../../src/lib/aiUsage.js'

describe('aiFeatureLabel', () => {
  it('returns the display label for a known feature key', () => {
    expect(aiFeatureLabel('titles')).toBe('Suggest titles')
  })

  it('falls back to the raw key for a feature with no label yet', () => {
    expect(aiFeatureLabel('some_new_feature')).toBe('some_new_feature')
  })
})
