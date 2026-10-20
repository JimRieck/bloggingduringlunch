import { describe, expect, it } from 'vitest'
import {
  DESCRIPTION_MAX,
  cleanDescription,
  descriptionPrompt,
} from '../../../../supabase/functions/_shared/postDescription.ts'

describe('cleanDescription', () => {
  it('keeps a short answer as it is', () => {
    expect(cleanDescription('Why thirty focused minutes beat a free weekend.')).toBe(
      'Why thirty focused minutes beat a free weekend.',
    )
  })

  it('makes it one line and drops wrapping quotes and a "Description:" label', () => {
    expect(cleanDescription('  "Ship small,\n  ship often."  ')).toBe('Ship small, ship often.')
    expect(cleanDescription('Description: “Ship small.”')).toBe('Ship small.')
  })

  it('never goes over the limit, cutting at a word with an ellipsis', () => {
    const long = 'word '.repeat(60)
    const result = cleanDescription(long)
    expect(result.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
    expect(result.endsWith('word…')).toBe(true)
  })

  it('still fits when there is no space to cut at', () => {
    expect(cleanDescription('x'.repeat(400))).toHaveLength(DESCRIPTION_MAX)
  })

  it('is empty for an empty answer', () => {
    expect(cleanDescription('   ')).toBe('')
  })
})

describe('descriptionPrompt', () => {
  it('includes the title and the post', () => {
    const prompt = descriptionPrompt('Lunch shipping', 'Thirty minutes a day.')
    expect(prompt).toContain('Title: Lunch shipping')
    expect(prompt).toContain('Thirty minutes a day.')
  })
})
