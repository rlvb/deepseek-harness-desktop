// @vitest-environment jsdom

import { useSyncExternalStore, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {} from '../src/client/index.js'
import { InternalMarketLauncher, MarketLauncher, type MarketLauncherProps } from '../src/client/MarketLauncher.js'
import { createMarketViewStore } from '../src/client/market-view-store.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, icon, variant: _variant, ...props }: {
    children?: ReactNode
    icon?: ReactNode
    variant?: string
    [key: string]: unknown
  }) => <button {...props}>{icon}{children}</button>,
  Tooltip: ({ children }: { children: unknown }) => children,
}))

afterEach(() => { cleanup() })

const t = ((key: string) => key) as PropsLocale<'community-market'>['t']

describe('community market launcher', () => {
  it('opens the market and reflects narrow versus wide sidebar presentation', () => {
    const instance = createMarketViewStore().create()
    const useStore = <T,>(selector: (state: { open: boolean; initialView: 'discover' | 'internal' }) => T): T => useSyncExternalStore(
      instance.subscribe,
      () => selector(instance.getSnapshot()),
    )
    const props = {
      wide: false,
      actions: instance.actions,
      useStore,
      t,
      useSessions: (() => undefined) as MarketLauncherProps['useSessions'],
      useSessionPendingInteraction: (() => undefined) as MarketLauncherProps['useSessionPendingInteraction'],
      useWorkspaces: (() => undefined) as MarketLauncherProps['useWorkspaces'],
      usePanelInfo: (select => select({ activePanelId: null })) as MarketLauncherProps['usePanelInfo'],
    } satisfies MarketLauncherProps

    const { rerender } = render(<MarketLauncher {...props} />)
    const button = screen.getByRole('button', { name: 'tab' })
    expect(button.getAttribute('data-wide')).toBe('false')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.textContent).not.toContain('tab')
    expect(button.querySelector('svg')?.getAttribute('data-icon')).toBe('market-store')

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')

    rerender(<MarketLauncher {...props} wide />)
    expect(button.getAttribute('data-wide')).toBe('true')
    expect(button.textContent).toContain('tab')
  })

  it('opens the private internal catalog directly from the dedicated entry', () => {
    const instance = createMarketViewStore().create()
    const useStore = <T,>(selector: (state: { open: boolean; initialView: 'discover' | 'internal' }) => T): T => useSyncExternalStore(
      instance.subscribe,
      () => selector(instance.getSnapshot()),
    )
    const props = {
      wide: true,
      actions: instance.actions,
      useStore,
      t,
      useSessions: (() => undefined) as MarketLauncherProps['useSessions'],
      useSessionPendingInteraction: (() => undefined) as MarketLauncherProps['useSessionPendingInteraction'],
      useWorkspaces: (() => undefined) as MarketLauncherProps['useWorkspaces'],
      usePanelInfo: (select => select({ activePanelId: null })) as MarketLauncherProps['usePanelInfo'],
    } satisfies MarketLauncherProps

    render(<InternalMarketLauncher {...props} />)
    const button = screen.getByRole('button', { name: 'internalPlugins' })
    fireEvent.click(button)
    expect(instance.getSnapshot()).toMatchObject({ open: true, initialView: 'internal' })
  })
})
