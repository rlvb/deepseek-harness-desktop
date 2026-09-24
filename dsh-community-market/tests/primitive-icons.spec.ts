import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { resolvePrimitiveIcon } from '../src/client/primitive-icons.js'

const legacy = vi.hoisted(() => ({ icon: () => null }))

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconCheckOutlineRegular: undefined,
  IconCheckOutline14: legacy.icon,
  IconCheckOutline16: legacy.icon,
  IconChevronDownOutlineRegular: undefined,
  IconChevronDownOutline14: legacy.icon,
  IconChevronUpOutlineRegular: undefined,
  IconChevronUpOutline14: legacy.icon,
  IconCloseOutlineRegular: undefined,
  IconCloseOutline16: legacy.icon,
  IconCordisPluginOutlineRegular: undefined,
  IconCordisPluginOutline14: legacy.icon,
  IconDataOutlineRegular: undefined,
  IconDataOutline16: legacy.icon,
  IconDownloadOutlineRegular: undefined,
  IconDownloadOutline16: legacy.icon,
  IconGlobeOutlineRegular: undefined,
  IconGlobeOutline14: legacy.icon,
  IconPlusOutlineRegular: undefined,
  IconPlusOutline16: legacy.icon,
  IconRefreshOutlineRegular: undefined,
  IconRefreshOutline14: legacy.icon,
  IconRefreshOutline16: legacy.icon,
  IconRightUpOutlineRegular: undefined,
  IconRightUpOutline14: legacy.icon,
  IconRightUpOutline16: legacy.icon,
  IconSearchOutlineRegular: undefined,
  IconSearchOutline16: legacy.icon,
  IconSettingsOutlineRegular: undefined,
  IconSettingsOutline14: legacy.icon,
  IconSettingsOutline16: legacy.icon,
  IconTrashOutlineRegular: undefined,
  IconTrashOutline16: legacy.icon,
}))

import * as icons from '../src/client/primitive-icons.js'

const modernIcon = () => null

describe('community market UI primitive icon compatibility', () => {
  it('prefers the current icon export when available', () => {
    expect(resolvePrimitiveIcon({ IconSearchOutlineRegular: modernIcon, IconSearchOutline16: legacy.icon },
      'IconSearchOutlineRegular', 'IconSearchOutline16')).toBe(modernIcon)
  })

  it('resolves every market icon against the fixed-size exports in Desktop 0.1.5', () => {
    expect([
      icons.IconCheckOutlineRegular,
      icons.IconChevronDownOutlineRegular,
      icons.IconChevronUpOutlineRegular,
      icons.IconCloseOutlineRegular,
      icons.IconCordisPluginOutlineRegular,
      icons.IconDataOutlineRegular,
      icons.IconDownloadOutlineRegular,
      icons.IconGlobeOutlineRegular,
      icons.IconPlusOutlineRegular,
      icons.IconRefreshOutlineRegular,
      icons.IconRightUpOutlineRegular,
      icons.IconSearchOutlineRegular,
      icons.IconSettingsOutlineRegular,
      icons.IconTrashOutlineRegular,
    ]).toEqual(Array.from({ length: 14 }, () => legacy.icon))
  })

  it('fails with the missing export names instead of returning an undefined React component', () => {
    expect(() => resolvePrimitiveIcon({}, 'IconCloseOutlineRegular', 'IconCloseOutline16'))
      .toThrow('UI primitive icon export is missing (IconCloseOutlineRegular | IconCloseOutline16)')
  })
})
