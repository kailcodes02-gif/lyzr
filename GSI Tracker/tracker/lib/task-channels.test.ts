import { describe, it, expect } from 'vitest'
import { mergeChannelsByName } from './task-channels'

const ch = (id: string, vertical_id: string, slug: string, parent_channel_id: string | null = null, sort_order = 0) =>
  ({ id, vertical_id, slug, parent_channel_id, sort_order })

describe('mergeChannelsByName', () => {
  const lyzr = 'v-lyzr', gsi = 'v-gsi'
  const channels = [
    ch('L-content', lyzr, 'content', null, 1),
    ch('G-content', gsi, 'content', null, 1),
    ch('L-blog', lyzr, 'blog', 'L-content'),
    ch('G-blog', gsi, 'blog', 'G-content'),
    ch('G-abm', gsi, 'abm', null, 2),            // only GSI has it
    ch('G-abm-emea', gsi, 'emea', 'G-abm'),
  ]

  it('keeps one channel per name, preferring the home vertical copy', () => {
    const { channels: merged } = mergeChannelsByName(channels, lyzr)
    expect(merged.map(c => c.id).sort()).toEqual(['G-abm', 'G-abm-emea', 'L-blog', 'L-content'])
  })

  it('remembers every id a merged channel stands for', () => {
    const { twins } = mergeChannelsByName(channels, lyzr)
    expect(twins.get('L-content')).toEqual(['L-content', 'G-content'])
    expect(twins.get('L-blog')).toEqual(['L-blog', 'G-blog'])
    expect(twins.get('G-abm')).toEqual(['G-abm'])
  })

  it('re-parents a kept child onto the kept parent', () => {
    const { channels: merged } = mergeChannelsByName(channels, gsi)
    const blog = merged.find(c => c.slug === 'blog')!
    expect(blog.id).toBe('G-blog')
    expect(blog.parent_channel_id).toBe('G-content')
    const emea = merged.find(c => c.slug === 'emea')!
    expect(emea.parent_channel_id).toBe('G-abm')
  })

  it('does not merge same-slug children under different parents', () => {
    const list = [ch('a', lyzr, 'paid'), ch('b', lyzr, 'organic'), ch('a-x', lyzr, 'x', 'a'), ch('b-x', lyzr, 'x', 'b')]
    expect(mergeChannelsByName(list, lyzr).channels).toHaveLength(4)
  })
})
