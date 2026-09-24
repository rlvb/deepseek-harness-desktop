import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComponentType } from 'react'

type IconComponent = ComponentType<{ size?: number }>
type PrimitiveExportTable = Readonly<Record<string, unknown>>

/**
 * The market can run inside Desktop releases whose bundled UI primitives
 * predate the `*OutlineRegular` icon names. Resolve the current name first,
 * then the fixed-size names exported by those older Desktop runtimes.
 */
export function resolvePrimitiveIcon(
  exports: PrimitiveExportTable,
  ...names: readonly string[]
): IconComponent {
  for (const name of names) {
    const value = exports[name]
    if (typeof value === 'function') return value as IconComponent
  }
  throw new Error(`dsh-community-market: UI primitive icon export is missing (${names.join(' | ')})`)
}

const exportTable = primitives as unknown as PrimitiveExportTable

export const IconCheckOutlineRegular = resolvePrimitiveIcon(
  exportTable, 'IconCheckOutlineRegular', 'IconCheckOutline16', 'IconCheckOutline14',
)
export const IconChevronDownOutlineRegular = resolvePrimitiveIcon(
  exportTable, 'IconChevronDownOutlineRegular', 'IconChevronDownOutline14',
)
export const IconChevronUpOutlineRegular = resolvePrimitiveIcon(
  exportTable, 'IconChevronUpOutlineRegular', 'IconChevronUpOutline14',
)
export const IconCloseOutlineRegular = resolvePrimitiveIcon(
  exportTable, 'IconCloseOutlineRegular', 'IconCloseOutline16',
)
export const IconCordisPluginOutlineRegular = resolvePrimitiveIcon(
  exportTable, 'IconCordisPluginOutlineRegular', 'IconCordisPluginOutline14',
)
export const IconDataOutlineRegular = resolvePrimitiveIcon(
  exportTable, 'IconDataOutlineRegular', 'IconDataOutline16',
)
export const IconDownloadOutlineRegular = resolvePrimitiveIcon(
  exportTable, 'IconDownloadOutlineRegular', 'IconDownloadOutline16',
)
export const IconGlobeOutlineRegular = resolvePrimitiveIcon(
  exportTable, 'IconGlobeOutlineRegular', 'IconGlobeOutline14',
)
export const IconPlusOutlineRegular = resolvePrimitiveIcon(
  exportTable, 'IconPlusOutlineRegular', 'IconPlusOutline16',
)
export const IconRefreshOutlineRegular = resolvePrimitiveIcon(
  exportTable, 'IconRefreshOutlineRegular', 'IconRefreshOutline16', 'IconRefreshOutline14',
)
export const IconRightUpOutlineRegular = resolvePrimitiveIcon(
  exportTable, 'IconRightUpOutlineRegular', 'IconRightUpOutline16', 'IconRightUpOutline14',
)
export const IconSearchOutlineRegular = resolvePrimitiveIcon(
  exportTable, 'IconSearchOutlineRegular', 'IconSearchOutline16',
)
export const IconSettingsOutlineRegular = resolvePrimitiveIcon(
  exportTable, 'IconSettingsOutlineRegular', 'IconSettingsOutline16', 'IconSettingsOutline14',
)
export const IconTrashOutlineRegular = resolvePrimitiveIcon(
  exportTable, 'IconTrashOutlineRegular', 'IconTrashOutline16',
)
