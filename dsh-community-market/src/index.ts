import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import {
  registerMarketRoutes,
  type MarketDesktopPlugins,
  type MarketInternalCredentials,
  type MarketInternalCredentialsProvider,
} from './host/routes.js'
import { DeferredMarketStateStore } from './catalog/state-store.js'
import { createRestrictedHttpClient } from './network/restricted-http.js'
import {
  createMarketPackageVerifier,
  MarketInstallService,
  type MarketDesktopPnpm,
  type MarketDesktopProfile,
} from './install/service.js'

export const name = 'community-market'
export const inject = ['webServer']

interface DesktopProfilesCapability {
  readonly current: MarketDesktopProfile
}

interface DesktopActionsCapability {
  openTerminal?(): void
  requestRestart(): Promise<void>
}

const npmRegistryHttp = createRestrictedHttpClient({
  // This is a compiled-in official registry hostname, never provider input.
  syntheticProxyHostnames: ['registry.npmjs.org'],
})

export function apply(ctx: Context): void {
  // Routes keep one store for their whole lifetime. It switches to durable
  // storage when the optional storage domain becomes available.
  const state = new DeferredMarketStateStore(message => ctx.logger.warn(message))
  let installService: MarketInstallService | undefined
  let desktopActions: DesktopActionsCapability | undefined
  let desktopPlugins: MarketDesktopPlugins | undefined
  let internalCredentials: MarketInternalCredentials | undefined
  const installProvider = { get: () => installService }
  const desktopActionsProvider = { get: () => desktopActions }
  const desktopPluginsProvider = { get: () => desktopPlugins }
  const internalCredentialsProvider: MarketInternalCredentialsProvider = { get: () => internalCredentials }
  ctx.effect(
    () => registerMarketRoutes(
      ctx,
      state,
      installProvider,
      desktopActionsProvider,
      desktopPluginsProvider,
      internalCredentialsProvider,
    ),
    'community-market: routes',
  )
  // Durable storage is optional; without it, the market remains usable for the
  // current session. Import its implementation only when the capability exists.
  ctx.inject(['storageDomain'], (storageCtx) => {
    storageCtx.effect(async () => {
      let close: (() => Promise<void>) | undefined
      try {
        const { activateMarketDurableState } = await import('./catalog/domain.js')
        close = await activateMarketDurableState(storageCtx, state)
      } catch (cause) {
        ctx.logger.warn(`dsh-community-market: durable storage is unavailable; market state is session-only: ${
          cause instanceof Error ? cause.message : String(cause)
        }`)
      }
      return () => close?.()
    }, 'community-market: durable state')
  })
  // The private internal catalog uses only the current Sub2API OpenAI group
  // Key. Its capability is soft-injected so public market profiles still load.
  ctx.inject(['dshSub2ApiCredentials'], (credentialsCtx) => {
    const credentials = credentialsCtx.get('dshSub2ApiCredentials') as MarketInternalCredentials
    credentialsCtx.effect(() => {
      internalCredentials = credentials
      return () => {
        if (internalCredentials === credentials) internalCredentials = undefined
      }
    }, 'community-market: optional private market credentials')
  })
  ctx.inject(['desktopActions'], (desktopCtx) => {
    const actions = desktopCtx.get('desktopActions') as DesktopActionsCapability
    desktopCtx.effect(() => {
      desktopActions = actions
      return () => {
        if (desktopActions === actions) desktopActions = undefined
      }
    }, 'community-market: optional desktop actions')
  })
  ctx.inject(['desktopPlugins'], (desktopCtx) => {
    const plugins = desktopCtx.get('desktopPlugins') as MarketDesktopPlugins
    desktopCtx.effect(() => {
      desktopPlugins = plugins
      return () => {
        if (desktopPlugins === plugins) desktopPlugins = undefined
      }
    }, 'community-market: optional desktop plugin management')
  })
  // Browsing remains portable. Desktop-only package operations appear whenever
  // the narrow profile and package-manager capabilities are live.
  ctx.inject(['desktopProfiles', 'desktopPnpm'], (desktopCtx) => {
    const profiles = desktopCtx.get('desktopProfiles') as DesktopProfilesCapability
    const pnpm = desktopCtx.get('desktopPnpm') as MarketDesktopPnpm
    desktopCtx.effect(() => {
      const service = new MarketInstallService(
        () => profiles.current,
        pnpm,
        createMarketPackageVerifier(npmRegistryHttp),
        {
          logFailure: message => ctx.logger.error(message),
        },
      )
      installService = service
      return () => {
        if (installService === service) installService = undefined
        service.dispose()
      }
    }, 'community-market: desktop package operations')
  })
}

export { marketRoutes } from './host/routes.js'
export { BUILT_IN_PROVIDERS, DefaultCatalogService } from './catalog/service.js'
export { dsh1024StoreAdapter } from './adapters/dsh-1024store.js'
export { dshfindAdapter } from './adapters/dshfind.js'
export type * from './api-types.js'
export * from './contracts/index.js'
