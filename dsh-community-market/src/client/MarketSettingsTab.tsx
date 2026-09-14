import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconCordisPluginOutline14,
  IconDataOutline16,
  IconDownloadOutline16,
  IconGlobeOutline14,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconRightUpOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconTrashOutline16,
  Input,
  Modal,
  Pill,
  StateDot,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CatalogSnapshot } from '../contracts/generated/catalog-snapshot.js'
import type {
  MarketBuiltInProvider,
  MarketCatalogResponse,
  MarketCatalogSourceResult,
  MarketInstallationView,
  MarketInternalPlugin,
  MarketInternalPluginsResponse,
  MarketInstallableResponse,
  MarketOperationPreviewRequest,
  MarketOperationPreviewResponse,
  MarketSourceMutation,
  MarketSourceView,
  MarketStateResponse,
} from '../api-types.js'
import { marketMediaAssetUrl } from '../media/ref.js'
import { dsh1024StoreProjectUrl, isDsh1024StoreAdapterId } from '../adapters/dsh-1024store-link.js'
import {
  executeMarketOperation,
  issueMarketInternalInstallTicket,
  mutateMarketSource,
  openMarketTerminal,
  previewMarketInternalInstall,
  previewMarketOperation,
  readMarketCatalog,
  readMarketInstallable,
  readMarketInternalPlugins,
  readMarketInternalProject,
  readMarketInstallations,
  readMarketState,
  readMoreMarketCatalog,
  requestMarketRestart,
} from './api.js'

type MarketItem = CatalogSnapshot['items'][number]
export type MarketView = 'discover' | 'installable' | 'installed' | 'internal' | 'sources'
const INSTALL_REQUIREMENTS_DOCS = {
  en: 'https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-community-market/docs/install-and-uninstall.md',
  zh: 'https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-community-market/docs/install-and-uninstall.zh.md',
} as const
const CATALOG_ADAPTER_GUIDE_DOCS = {
  en: 'https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-community-market/docs/catalog-adapter-guide.md',
  zh: 'https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-community-market/docs/catalog-adapter-guide.zh.md',
} as const
const DSH_DESKTOP_ISSUES_URL = 'https://github.com/anywhere-labs/deepseek-harness-desktop/issues'

function installRequirementsUrl(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? INSTALL_REQUIREMENTS_DOCS.zh : INSTALL_REQUIREMENTS_DOCS.en
}

function catalogAdapterGuideUrl(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? CATALOG_ADAPTER_GUIDE_DOCS.zh : CATALOG_ADAPTER_GUIDE_DOCS.en
}

interface VisibleItem {
  readonly item: MarketItem
  readonly source: MarketSourceView
  readonly stale: boolean
}

interface CompletedOperation {
  readonly preview: MarketOperationPreviewResponse
  readonly restartToken: string
}

type ManualInstallHint = MarketCatalogResponse['manualInstall'][number]

type InstallationLoadOutcome =
  | { readonly installations: readonly MarketInstallationView[] }
  | { readonly error: string }

function visibleItemKey(value: VisibleItem): string {
  return `${value.source.sourceRecordId}\0${value.source.providerId}\0${value.item.id}\0${value.item.package?.name ?? ''}`
}

function marketProjectUrl(value: VisibleItem): string | undefined {
  if (!isDsh1024StoreAdapterId(value.source.adapterId)) return undefined
  return dsh1024StoreProjectUrl(value.item.id)
}

function matchingInstallation(
  value: VisibleItem,
  installations: readonly MarketInstallationView[],
): MarketInstallationView | undefined {
  const packageName = value.item.package?.name
  if (packageName === undefined) return undefined
  const matches = installations.filter(installation => installation.packageName === packageName)
  return matches.length === 1 ? matches[0] : undefined
}

function isDesktopUnavailable(cause: unknown): boolean {
  return cause !== null
    && typeof cause === 'object'
    && 'status' in cause
    && (cause as { status?: unknown }).status === 503
}

function operationErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0
    ? cause.message
    : fallback
}

function operationErrorDetails(cause: unknown): string | undefined {
  const details = cause !== null && typeof cause === 'object' && 'details' in cause
    ? (cause as { readonly details?: unknown }).details
    : undefined
  return typeof details === 'string' && details.trim().length > 0 ? details : undefined
}

function catalogFailureMessage(
  cause: unknown,
  source: MarketSourceView,
  t: MarketSettingsTabProps['t'],
): string {
  const code = cause !== null && typeof cause === 'object' && 'code' in cause
    ? (cause as { code?: unknown }).code
    : undefined
  const reason = code === 'catalog-timeout'
    ? t('catalogFailureTimeout')
    : code === 'catalog-invalid-response'
      ? t('catalogFailureInvalidResponse')
      : t('catalogFailureUnavailable')
  return `${t('catalogFailureSource')}: ${source.name}. ${reason}`
}

function internalFailureMessage(cause: unknown, t: MarketSettingsTabProps['t']): string {
  const code = cause !== null && typeof cause === 'object' && 'code' in cause
    ? (cause as { readonly code?: unknown }).code
    : undefined
  if (code === 'internal-key-required') return t('internalKeyRequired')
  if (code === 'internal-key-invalid') return t('internalKeyInvalid')
  if (code === 'internal-permission-denied') return t('internalPermissionDenied')
  if (code === 'internal-invalid-response') return t('internalInvalidResponse')
  if (code === 'already-installed') return t('internalAlreadyInstalled')
  if (code === 'conflict') return t('internalConflict')
  if (code === 'internal-service-timeout') return t('internalTimeout')
  if (code === 'internal-network-blocked') return t('internalNetworkBlocked')
  if (code === 'internal-upstream-error') return t('internalUpstreamError')
  if (code === 'internal-install-unsupported' || code === 'verification-failed') {
    return t('internalInstallUnavailable')
  }
  if (code === 'internal-service-unavailable') return t('internalUnavailable')
  // Package-operation errors are safe Host-authored messages. Keeping their
  // exact reason prevents a local Profile conflict from being mislabeled as
  // a private Store outage.
  if (typeof code === 'string' && cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message
  }
  return t('internalUnavailable')
}

function PluginIcon({ item, large = false }: { item: MarketItem; large?: boolean }) {
  const icon = item.media?.icon
  return (
    <div className={large ? 'dshMarketGlyph dshMarketGlyphLarge' : 'dshMarketGlyph'}>
      <IconCordisPluginOutline14 size={large ? 28 : 20} />
      {icon !== undefined && (
        <img
          src={marketMediaAssetUrl(icon.assetRef)}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={event => { event.currentTarget.remove() }}
        />
      )}
    </div>
  )
}

export type MarketSettingsTabProps = PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'community-market'>
  & {
    readLocale: () => string
    initialView?: MarketView
  }

export interface MarketSurfaceProps {
  readonly readLocale: () => string
  readonly t: MarketSettingsTabProps['t']
  readonly showHeader?: boolean
  readonly initialView?: MarketView
}

function retainEnabledCatalog(
  catalog: MarketCatalogResponse | undefined,
  sources: readonly MarketSourceView[],
): MarketCatalogResponse | undefined {
  if (catalog === undefined) return undefined
  const selected = [...sources]
    .filter(source => source.enabled)
    .sort((left, right) => left.order - right.order)
    .at(0)
  if (selected === undefined) return undefined
  const result = catalog.results.find(value => value.source.sourceRecordId === selected.sourceRecordId)
  return result === undefined ? undefined : { ...catalog, results: [{ ...result, source: selected }] }
}

function selectedSource(sources: readonly MarketSourceView[]): MarketSourceView | undefined {
  return [...sources]
    .filter(source => source.enabled)
    .sort((left, right) => left.order - right.order)
    .at(0)
}

function mergeCatalogPages(
  catalog: MarketCatalogResponse | undefined,
  pages: readonly MarketCatalogSourceResult[],
  manualInstall: readonly ManualInstallHint[],
): MarketCatalogResponse | undefined {
  if (catalog === undefined || pages.length === 0) return catalog
  const updates = new Map(pages.map(page => [page.source.sourceRecordId, page]))
  const results = catalog.results.map(current => {
    const next = updates.get(current.source.sourceRecordId)
    if (current.snapshot === undefined || next?.snapshot === undefined) return current
    const seen = new Set<string>()
    const items = [...current.snapshot.items, ...next.snapshot.items].filter(item => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    return {
      ...next,
      source: current.source,
      snapshot: { ...next.snapshot, items, page: next.snapshot.page },
    }
  })
  const hints = new Map([...catalog.manualInstall, ...manualInstall].map(hint => [
    `${hint.sourceRecordId}:${hint.itemId}`,
    hint,
  ]))
  return { ...catalog, results, manualInstall: [...hints.values()], fetchedAt: new Date().toISOString() }
}

function mergeInstallablePages(
  current: MarketInstallableResponse | undefined,
  next: MarketInstallableResponse,
): MarketInstallableResponse {
  if (current === undefined || current.source.sourceRecordId !== next.source.sourceRecordId) return next
  const seen = new Set<string>()
  const items = [...current.items, ...next.items].filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
  const hints = new Map([...current.manualInstall, ...next.manualInstall].map(hint => [
    `${hint.sourceRecordId}:${hint.itemId}`,
    hint,
  ]))
  return {
    ...next,
    items,
    categories: next.categories.length === 0 ? current.categories : next.categories,
    manualInstall: [...hints.values()],
  }
}

export function MarketSurface({ initialView = 'installable', readLocale, t, showHeader = true }: MarketSurfaceProps) {
  const [view, setView] = useState<MarketView>(initialView)
  const [state, setState] = useState<MarketStateResponse>()
  const [catalog, setCatalog] = useState<MarketCatalogResponse>()
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [categoryOptions, setCategoryOptions] = useState<readonly string[]>([])
  const [selectedCategories, setSelectedCategories] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()
  const [loadMoreError, setLoadMoreError] = useState<string>()
  const [selected, setSelected] = useState<VisibleItem>()
  const [selectedInternal, setSelectedInternal] = useState<MarketInternalPlugin>()
  const [addOpen, setAddOpen] = useState(false)
  const [manifestUrl, setManifestUrl] = useState('')
  const [mutationError, setMutationError] = useState<string>()
  const [mutationPending, setMutationPending] = useState(false)
  const [installations, setInstallations] = useState<readonly MarketInstallationView[]>([])
  const [installableIndex, setInstallableIndex] = useState<MarketInstallableResponse>()
  const [installableQuery, setInstallableQuery] = useState('')
  const [appliedInstallableQuery, setAppliedInstallableQuery] = useState('')
  const [installableCategories, setInstallableCategories] = useState<readonly string[]>([])
  const [installableLoaded, setInstallableLoaded] = useState(false)
  const [installableLoading, setInstallableLoading] = useState(false)
  const [installableLoadingMore, setInstallableLoadingMore] = useState(false)
  const [installableUnavailable, setInstallableUnavailable] = useState(false)
  const [installableError, setInstallableError] = useState<string>()
  const [internalIndex, setInternalIndex] = useState<MarketInternalPluginsResponse>()
  const [internalQuery, setInternalQuery] = useState('')
  const [internalAppliedQuery, setInternalAppliedQuery] = useState('')
  const [internalLoaded, setInternalLoaded] = useState(false)
  const [internalLoading, setInternalLoading] = useState(false)
  const [internalError, setInternalError] = useState<string>()
  const [internalTicketPending, setInternalTicketPending] = useState(false)
  const [selectedInternalLoading, setSelectedInternalLoading] = useState(false)
  const [selectedInternalError, setSelectedInternalError] = useState<string>()
  const [installationsLoaded, setInstallationsLoaded] = useState(false)
  const [installationsLoading, setInstallationsLoading] = useState(false)
  const [installationsUnavailable, setInstallationsUnavailable] = useState(false)
  const [installationsError, setInstallationsError] = useState<string>()
  const [selectedInstallation, setSelectedInstallation] = useState<MarketInstallationView>()
  const [selectedInventoryLoading, setSelectedInventoryLoading] = useState(false)
  const [selectedInventoryError, setSelectedInventoryError] = useState<string>()
  const [operationPreview, setOperationPreview] = useState<MarketOperationPreviewResponse>()
  const [operationSuccess, setOperationSuccess] = useState<CompletedOperation>()
  const [operationError, setOperationError] = useState<string>()
  const [operationErrorDetailsValue, setOperationErrorDetailsValue] = useState<string>()
  const [operationExecutionFailed, setOperationExecutionFailed] = useState(false)
  const [operationPending, setOperationPending] = useState(false)
  const [desktopActionError, setDesktopActionError] = useState<string>()
  const [desktopActionPending, setDesktopActionPending] = useState(false)
  const readRequest = useRef<AbortController>()
  const pageRequest = useRef<AbortController>()
  const mutationRequest = useRef<AbortController>()
  const installableRequest = useRef<AbortController>()
  const internalRequest = useRef<AbortController>()
  const selectedInternalRequest = useRef<AbortController>()
  const installationsRequest = useRef<AbortController>()
  const operationRequest = useRef<AbortController>()
  const operationStage = useRef<'preview' | 'execute'>()
  const desktopActionRequest = useRef<AbortController>()
  const selectedKeyRef = useRef<string>()
  const viewRef = useRef<MarketView>(initialView)

  const rememberCategories = useCallback((next: MarketCatalogResponse) => {
    setCategoryOptions([...next.categories]
      .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' })))
  }, [])

  const loadCatalog = useCallback(async (
    nextState: MarketStateResponse,
    q: string,
    categories: readonly string[],
    forceRefresh = false,
  ) => {
    readRequest.current?.abort()
    pageRequest.current?.abort()
    pageRequest.current = undefined
    setLoadingMore(false)
    setLoadMoreError(undefined)
    const selected = selectedSource(nextState.sources)
    if (selected === undefined) {
      readRequest.current = undefined
      setCatalog(undefined)
      setQuery('')
      setAppliedQuery('')
      setCategoryOptions([])
      setSelectedCategories([])
      setError(undefined)
      setLoading(false)
      return
    }
    const effectiveQuery = q.trim()
    const request = new AbortController()
    readRequest.current = request
    setLoading(true)
    setError(undefined)
    let catalogApplied = false
    const applyCatalog = (next: MarketCatalogResponse): MarketCatalogResponse | undefined => {
      const retained = retainEnabledCatalog(next, nextState.sources)
      const result = retained?.results[0]
      if (retained === undefined || result?.snapshot === undefined) return undefined
      rememberCategories(retained)
      setAppliedQuery(effectiveQuery)
      setSelectedCategories([...categories])
      setCatalog(retained)
      catalogApplied = true
      return retained
    }
    try {
      const next = forceRefresh
        ? await readMarketCatalog(selected.sourceRecordId, effectiveQuery, readLocale(), categories, request.signal, true)
        : await readMarketCatalog(selected.sourceRecordId, effectiveQuery, readLocale(), categories, request.signal)
      if (!request.signal.aborted && readRequest.current === request) {
        const retained = applyCatalog(next)
        if (retained === undefined) {
          setError(catalogFailureMessage({ code: 'catalog-invalid-response' }, selected, t))
          return
        }
        if (!forceRefresh
          && effectiveQuery === ''
          && categories.length === 0
          && retained.results[0]?.stale === true) {
          const refreshed = await readMarketCatalog(
            selected.sourceRecordId,
            effectiveQuery,
            readLocale(),
            categories,
            request.signal,
            true,
          )
          if (!request.signal.aborted && readRequest.current === request) applyCatalog(refreshed)
        }
      }
    } catch (cause) {
      if (!request.signal.aborted && readRequest.current === request && !catalogApplied) {
        setError(catalogFailureMessage(cause, selected, t))
      }
    } finally {
      if (readRequest.current === request) {
        readRequest.current = undefined
        setLoading(false)
      }
    }
  }, [readLocale, rememberCategories, t])

  const loadState = useCallback(async (
    q: string,
    categories: readonly string[],
    forceRefresh = false,
    loadCatalogAfterState = true,
  ) => {
    if (mutationRequest.current !== undefined) return
    readRequest.current?.abort()
    pageRequest.current?.abort()
    pageRequest.current = undefined
    setLoadingMore(false)
    setLoadMoreError(undefined)
    const request = new AbortController()
    readRequest.current = request
    setLoading(true)
    setError(undefined)
    try {
      const next = await readMarketState(request.signal)
      if (request.signal.aborted || readRequest.current !== request) return
      setState(next)
      setCatalog(current => retainEnabledCatalog(current, next.sources))
      readRequest.current = undefined
      if (!loadCatalogAfterState) {
        if (viewRef.current === 'discover') {
          await loadCatalog(next, q, categories, forceRefresh)
        } else {
          setLoading(false)
        }
        return
      }
      await loadCatalog(next, q, categories, forceRefresh)
    } catch {
      if (!request.signal.aborted && readRequest.current === request) setError(t('catalogError'))
    } finally {
      if (readRequest.current === request) {
        readRequest.current = undefined
        setLoading(false)
      }
    }
  }, [loadCatalog, t])

  const loadInstallations = useCallback(async (): Promise<InstallationLoadOutcome | undefined> => {
    installationsRequest.current?.abort()
    const request = new AbortController()
    installationsRequest.current = request
    setInstallationsLoading(true)
    setInstallationsError(undefined)
    setInstallationsUnavailable(false)
    try {
      const response = await readMarketInstallations(request.signal)
      if (request.signal.aborted || installationsRequest.current !== request) return
      setInstallations(response.installations)
      setInstallationsLoaded(true)
      setInstallationsUnavailable(false)
      return { installations: response.installations }
    } catch (cause) {
      if (request.signal.aborted || installationsRequest.current !== request) return
      const message = isDesktopUnavailable(cause) ? t('desktopUnavailable') : t('installationsError')
      setInstallationsUnavailable(isDesktopUnavailable(cause))
      setInstallationsError(message)
      return { error: message }
    } finally {
      if (installationsRequest.current === request) {
        installationsRequest.current = undefined
        setInstallationsLoading(false)
      }
    }
  }, [t])

  const loadInstallable = useCallback(async (
    refresh = false,
    q = '',
    categories: readonly string[] = [],
    page?: { readonly sourceRecordId: string; readonly cursor: string },
  ) => {
    installableRequest.current?.abort()
    const request = new AbortController()
    installableRequest.current = request
    const append = page !== undefined
    if (append) {
      setInstallableLoadingMore(true)
    } else {
      setInstallableIndex(undefined)
      setInstallableLoaded(false)
      setInstallableLoading(true)
    }
    setInstallableError(undefined)
    setInstallableUnavailable(false)
    try {
      const response = await readMarketInstallable(readLocale(), {
        ...(q.trim() === '' ? {} : { q: q.trim() }),
        ...(categories.length === 0 ? {} : { categories }),
        ...(page === undefined ? {} : page),
        refresh,
      }, request.signal)
      if (request.signal.aborted || installableRequest.current !== request) return
      setInstallableIndex(current => append ? mergeInstallablePages(current, response) : response)
      setInstallableLoaded(true)
      setInstallableUnavailable(false)
      setAppliedInstallableQuery(q.trim())
      setInstallableCategories([...categories])
    } catch (cause) {
      if (request.signal.aborted || installableRequest.current !== request) return
      if (!append) {
        setInstallableIndex(undefined)
        setInstallableLoaded(false)
      }
      setInstallableUnavailable(isDesktopUnavailable(cause))
      setInstallableError(isDesktopUnavailable(cause) ? t('desktopUnavailable') : t('installableError'))
    } finally {
      if (installableRequest.current === request) {
        installableRequest.current = undefined
        if (append) setInstallableLoadingMore(false)
        else setInstallableLoading(false)
      }
    }
  }, [readLocale, t])

  const loadInternal = useCallback(async (refresh = false, q = '') => {
    internalRequest.current?.abort()
    const request = new AbortController()
    internalRequest.current = request
    setInternalLoading(true)
    setInternalError(undefined)
    try {
      const response = await readMarketInternalPlugins(q, request.signal, refresh)
      if (request.signal.aborted || internalRequest.current !== request) return
      setInternalIndex(response)
      setInternalAppliedQuery(q.trim())
      setInternalLoaded(true)
    } catch (cause) {
      if (request.signal.aborted || internalRequest.current !== request) return
      setInternalIndex(undefined)
      setInternalLoaded(false)
      setInternalError(internalFailureMessage(cause, t))
    } finally {
      if (internalRequest.current === request) {
        internalRequest.current = undefined
        setInternalLoading(false)
      }
    }
  }, [t])

  const openInternalProject = async (plugin: MarketInternalPlugin) => {
    selectedInternalRequest.current?.abort()
    const request = new AbortController()
    selectedInternalRequest.current = request
    setSelectedInternal(plugin)
    setSelectedInternalLoading(true)
    setSelectedInternalError(undefined)
    try {
      const detail = await readMarketInternalProject(plugin.id, request.signal)
      if (request.signal.aborted || selectedInternalRequest.current !== request) return
      setSelectedInternal(detail)
    } catch (cause) {
      if (request.signal.aborted || selectedInternalRequest.current !== request) return
      setSelectedInternalError(internalFailureMessage(cause, t))
    } finally {
      if (selectedInternalRequest.current === request) {
        selectedInternalRequest.current = undefined
        setSelectedInternalLoading(false)
      }
    }
  }

  const beginInternalInstall = async (plugin: MarketInternalPlugin, versionId?: number) => {
    if (internalTicketPending || operationRequest.current !== undefined) return
    const request = new AbortController()
    operationRequest.current = request
    operationStage.current = 'preview'
    setInternalTicketPending(true)
    setOperationPending(true)
    setOperationPreview(undefined)
    setOperationError(undefined)
    setOperationErrorDetailsValue(undefined)
    setOperationExecutionFailed(false)
    setOperationSuccess(undefined)
    setDesktopActionError(undefined)
    setInternalError(undefined)
    selectedInternalRequest.current?.abort()
    setSelectedInternal(undefined)
    try {
      const ticket = versionId === undefined
        ? await issueMarketInternalInstallTicket(plugin.id, request.signal)
        : await issueMarketInternalInstallTicket(plugin.id, versionId, request.signal)
      if (request.signal.aborted || operationRequest.current !== request) return
      const preview = await previewMarketInternalInstall({
        pluginId: plugin.id,
        ticket: ticket.ticket,
        ...(ticket.artifactToken === undefined ? {} : { artifactToken: ticket.artifactToken }),
        ...(versionId === undefined ? {} : { versionId }),
        displayName: plugin.name,
      }, request.signal)
      if (request.signal.aborted || operationRequest.current !== request) return
      if (preview.action !== 'install') throw new Error('internal install preview action mismatch')
      setInstallationsUnavailable(false)
      setOperationPreview(preview)
    } catch (cause) {
      if (request.signal.aborted || operationRequest.current !== request) return
      if (isDesktopUnavailable(cause)) {
        setInstallationsUnavailable(true)
        setInstallationsError(t('desktopUnavailable'))
        setOperationError(t('desktopUnavailable'))
      } else {
        setInternalError(internalFailureMessage(cause, t))
        setOperationError(operationErrorMessage(cause, t('internalInstallUnavailable')))
      }
    } finally {
      if (operationRequest.current === request) {
        operationRequest.current = undefined
        operationStage.current = undefined
        setInternalTicketPending(false)
        setOperationPending(false)
      }
    }
  }

  useEffect(() => {
    setQuery('')
    if (viewRef.current === 'installable') {
      void loadState('', [], false, false)
      void loadInstallable(false, '', [])
    } else if (viewRef.current === 'internal') {
      void loadInternal(false, '')
    } else {
      void loadState('', [])
    }
    return () => {
      readRequest.current?.abort()
      pageRequest.current?.abort()
      mutationRequest.current?.abort()
      installableRequest.current?.abort()
      internalRequest.current?.abort()
      selectedInternalRequest.current?.abort()
      installationsRequest.current?.abort()
      operationRequest.current?.abort()
      desktopActionRequest.current?.abort()
      readRequest.current = undefined
      pageRequest.current = undefined
      mutationRequest.current = undefined
      installableRequest.current = undefined
      internalRequest.current = undefined
      selectedInternalRequest.current = undefined
      installationsRequest.current = undefined
      operationRequest.current = undefined
      desktopActionRequest.current = undefined
    }
  }, [loadInstallable, loadInternal, loadState])

  useEffect(() => {
    // Source state can resolve before React commits it. Load after the view and
    // state are committed, so a click in that gap cannot miss the first catalog.
    if (view === 'discover' && state !== undefined && selectedSource(state.sources) !== undefined
      && catalog === undefined && readRequest.current === undefined) {
      void loadCatalog(state, appliedQuery, selectedCategories)
    }
  }, [view, state, catalog, appliedQuery, selectedCategories, loadCatalog])

  const items = useMemo(() => catalog?.results.flatMap(result =>
    (result.snapshot?.items ?? []).map(item => ({ item, source: result.source, stale: result.stale }))) ?? [], [catalog])
  const installableCategoryOptions = installableIndex?.categories ?? []
  const installableItems = useMemo(
    () => (installableIndex?.items ?? []).map(item => ({ item, source: installableIndex!.source, stale: false })),
    [installableIndex],
  )
  const pageTarget = useMemo(() => catalog?.results.flatMap(result => {
    const cursor = result.snapshot?.page?.nextCursor
    return cursor === undefined ? [] : [{ sourceRecordId: result.source.sourceRecordId, cursor }]
  }).at(0), [catalog])
  const partialFailure = catalog?.results.some(result => result.error !== undefined) ?? false
  const currentSource = state === undefined ? undefined : selectedSource(state.sources)
  const currentSourceHref = currentSource === undefined
    ? undefined
    : safeHttpsExternalHref(currentSource.homepage) ?? safeHttpsExternalHref(currentSource.attribution?.url)
  const selectedManualInstall = useMemo(() => {
    if (selected === undefined) return undefined
    const hints = view === 'installable'
      ? installableIndex?.manualInstall ?? []
      : catalog?.manualInstall ?? []
    return hints.find(hint => (
      hint.sourceRecordId === selected.source.sourceRecordId
      && hint.providerId === selected.source.providerId
      && hint.itemId === selected.item.id
    ))
  }, [catalog, installableIndex, selected, view])

  const mutate = async (mutation: MarketSourceMutation): Promise<boolean> => {
    if (mutationRequest.current !== undefined) return false
    readRequest.current?.abort()
    pageRequest.current?.abort()
    installableRequest.current?.abort()
    internalRequest.current?.abort()
    readRequest.current = undefined
    pageRequest.current = undefined
    installableRequest.current = undefined
    internalRequest.current = undefined
    setLoading(false)
    setLoadingMore(false)
    setLoadMoreError(undefined)
    const request = new AbortController()
    mutationRequest.current = request
    setMutationPending(true)
    setMutationError(undefined)
    try {
      const sources = await mutateMarketSource(mutation, request.signal)
      if (request.signal.aborted || mutationRequest.current !== request) return false
      const next: MarketStateResponse = {
        sources,
        builtIns: state?.builtIns ?? [],
        desktopActions: state?.desktopActions ?? { openTerminal: false, requestRestart: false },
      }
      const sourceChanged = selectedSource(state?.sources ?? [])?.sourceRecordId
        !== selectedSource(sources)?.sourceRecordId
      setState(next)
      if (sourceChanged) {
        setCatalog(undefined)
        setInstallableIndex(undefined)
        setInstallableLoaded(false)
        setInstallableLoading(false)
        setInstallableLoadingMore(false)
        setInstallableUnavailable(false)
        setInstallableError(undefined)
        setInstallableQuery('')
        setAppliedInstallableQuery('')
        setInstallableCategories([])
        setQuery('')
        setAppliedQuery('')
        setCategoryOptions([])
        setSelectedCategories([])
        selectedKeyRef.current = undefined
        setSelected(undefined)
      } else {
        setCatalog(current => retainEnabledCatalog(current, sources))
      }
      mutationRequest.current = undefined
      setMutationPending(false)
      await loadCatalog(next, sourceChanged ? '' : appliedQuery, sourceChanged ? [] : selectedCategories)
      return true
    } catch {
      if (!request.signal.aborted && mutationRequest.current === request) setMutationError(t('sourceError'))
      return false
    } finally {
      if (mutationRequest.current === request) {
        mutationRequest.current = undefined
        setMutationPending(false)
      }
    }
  }

  const toggleCategory = (category: string) => {
    if (state === undefined) return
    const categories = selectedCategories.includes(category)
      ? selectedCategories.filter(value => value !== category)
      : [...selectedCategories, category]
    selectedKeyRef.current = undefined
    setSelected(undefined)
    void loadCatalog(state, appliedQuery, categories)
  }

  const loadMore = async () => {
    if (pageRequest.current !== undefined || pageTarget === undefined) return
    const request = new AbortController()
    pageRequest.current = request
    setLoadingMore(true)
    setLoadMoreError(undefined)
    try {
      const next = await readMoreMarketCatalog(
        pageTarget.sourceRecordId,
        pageTarget.cursor,
        appliedQuery,
        readLocale(),
        selectedCategories,
        request.signal,
      )
      if (request.signal.aborted || pageRequest.current !== request) return
      const page = next.results.find(value => value.source.sourceRecordId === pageTarget.sourceRecordId)
      if (page?.snapshot === undefined || page.error !== undefined) {
        setLoadMoreError(t('loadMoreError'))
        return
      }
      rememberCategories(next)
      setCatalog(current => mergeCatalogPages(current, [page], next.manualInstall))
    } catch {
      if (!request.signal.aborted && pageRequest.current === request) setLoadMoreError(t('loadMoreError'))
    } finally {
      if (pageRequest.current === request) {
        pageRequest.current = undefined
        setLoadingMore(false)
      }
    }
  }

  const selectMarketView = (next: MarketView) => {
    if (viewRef.current === next) return
    viewRef.current = next
    setView(next)
    selectedKeyRef.current = undefined
    setSelected(undefined)
    setOperationError(undefined)
    setOperationErrorDetailsValue(undefined)
    setOperationExecutionFailed(false)
    if (next === 'installable') {
      internalRequest.current?.abort()
      internalRequest.current = undefined
      setInternalLoading(false)
      installationsRequest.current?.abort()
      installationsRequest.current = undefined
      setInstallationsLoading(false)
      void loadInstallable(false, appliedInstallableQuery, installableCategories)
    } else if (next === 'installed') {
      internalRequest.current?.abort()
      internalRequest.current = undefined
      setInternalLoading(false)
      installableRequest.current?.abort()
      installableRequest.current = undefined
      setInstallableLoading(false)
      setInstallableLoadingMore(false)
      void loadInstallations()
    } else if (next === 'discover') {
      internalRequest.current?.abort()
      internalRequest.current = undefined
      setInternalLoading(false)
      installableRequest.current?.abort()
      installationsRequest.current?.abort()
      installableRequest.current = undefined
      installationsRequest.current = undefined
      setInstallableLoading(false)
      setInstallableLoadingMore(false)
      setInstallationsLoading(false)
      if (state !== undefined && catalog === undefined && readRequest.current === undefined) {
        void loadCatalog(state, appliedQuery, selectedCategories)
      }
    } else if (next === 'internal') {
      readRequest.current?.abort()
      pageRequest.current?.abort()
      installableRequest.current?.abort()
      installationsRequest.current?.abort()
      readRequest.current = undefined
      pageRequest.current = undefined
      installableRequest.current = undefined
      installationsRequest.current = undefined
      setLoading(false)
      setLoadingMore(false)
      setInstallableLoading(false)
      setInstallableLoadingMore(false)
      setInstallationsLoading(false)
      void loadInternal(false, internalAppliedQuery)
    } else {
      internalRequest.current?.abort()
      internalRequest.current = undefined
      setInternalLoading(false)
      installableRequest.current?.abort()
      installationsRequest.current?.abort()
      installableRequest.current = undefined
      installationsRequest.current = undefined
      setInstallableLoading(false)
      setInstallationsLoading(false)
    }
  }

  const beginOperationPreview = async (requestValue: MarketOperationPreviewRequest) => {
    if (operationRequest.current !== undefined) return
    const request = new AbortController()
    operationRequest.current = request
    operationStage.current = 'preview'
    setOperationPending(true)
    setOperationError(undefined)
    setOperationErrorDetailsValue(undefined)
    setOperationExecutionFailed(false)
    setDesktopActionError(undefined)
    setOperationSuccess(undefined)
    try {
      const preview = await previewMarketOperation(requestValue, request.signal)
      if (request.signal.aborted || operationRequest.current !== request) return
      if (preview.action !== requestValue.action) throw new Error('operation preview action mismatch')
      setInstallationsUnavailable(false)
      setOperationPreview(preview)
    } catch (cause) {
      if (request.signal.aborted || operationRequest.current !== request) return
      if (isDesktopUnavailable(cause)) {
        setInstallationsUnavailable(true)
        setInstallationsError(t('desktopUnavailable'))
        setOperationError(t('desktopUnavailable'))
      } else {
        setOperationError(operationErrorMessage(cause, t(requestValue.action === 'install'
          ? 'previewError'
          : 'uninstallPreviewError')))
      }
    } finally {
      if (operationRequest.current === request) {
        operationRequest.current = undefined
        operationStage.current = undefined
        setOperationPending(false)
      }
    }
  }

  const openItem = (value: VisibleItem) => {
    if (operationStage.current === 'execute') return
    if (operationStage.current === 'preview') {
      operationRequest.current?.abort()
      operationRequest.current = undefined
      operationStage.current = undefined
      setOperationPending(false)
    }
    const selectionKey = visibleItemKey(value)
    selectedKeyRef.current = selectionKey
    setSelected(value)
    setSelectedInstallation(undefined)
    setSelectedInventoryLoading(false)
    setSelectedInventoryError(undefined)
    setOperationPreview(undefined)
    setOperationSuccess(undefined)
    setOperationError(undefined)
    setOperationErrorDetailsValue(undefined)
    setOperationExecutionFailed(false)
    setDesktopActionError(undefined)
    const beginInstallPreview = () => {
      if (selectedKeyRef.current !== selectionKey) return
      void beginOperationPreview({
        action: 'install',
        sourceRecordId: value.source.sourceRecordId,
        itemId: value.item.id,
      })
    }
    const packageName = value.item.package?.name
    if (packageName === undefined) {
      beginInstallPreview()
      return
    }
    const resolveInventory = (current: readonly MarketInstallationView[]) => {
      if (selectedKeyRef.current !== selectionKey) return
      const installation = matchingInstallation(value, current)
      setSelectedInventoryLoading(false)
      if (installation !== undefined) setSelectedInstallation(installation)
      else beginInstallPreview()
    }
    if (installationsLoaded) {
      resolveInventory(installations)
      return
    }
    setSelectedInventoryLoading(true)
    void loadInstallations().then(outcome => {
      if (selectedKeyRef.current !== selectionKey || outcome === undefined) return
      if ('error' in outcome) {
        setSelectedInventoryLoading(false)
        setSelectedInventoryError(outcome.error)
        return
      }
      resolveInventory(outcome.installations)
    })
  }

  const closeItem = () => {
    if (operationPending && operationPreview !== undefined) return
    operationRequest.current?.abort()
    operationRequest.current = undefined
    operationStage.current = undefined
    desktopActionRequest.current?.abort()
    desktopActionRequest.current = undefined
    setOperationPending(false)
    setDesktopActionPending(false)
    selectedKeyRef.current = undefined
    setSelected(undefined)
    setSelectedInstallation(undefined)
    setSelectedInventoryLoading(false)
    setSelectedInventoryError(undefined)
    setOperationPreview(undefined)
    setOperationError(undefined)
    setOperationErrorDetailsValue(undefined)
    setOperationExecutionFailed(false)
    setDesktopActionError(undefined)
  }

  const executePreview = async () => {
    const preview = operationPreview
    if (preview === undefined || operationRequest.current !== undefined) return
    const request = new AbortController()
    operationRequest.current = request
    operationStage.current = 'execute'
    setOperationPending(true)
    setOperationError(undefined)
    setOperationErrorDetailsValue(undefined)
    setOperationExecutionFailed(false)
    setDesktopActionError(undefined)
    try {
      const result = await executeMarketOperation(preview.previewId, request.signal)
      if (request.signal.aborted || operationRequest.current !== request) return
      if (result.action !== preview.action) throw new Error('operation response action mismatch')
      setInstallations(current => {
        if (result.action === 'install') return current
        return current.filter(installation => installation.packageName !== result.packageName)
      })
      setInstallationsLoaded(true)
      setOperationPreview(undefined)
      selectedKeyRef.current = undefined
      setSelected(undefined)
      setOperationSuccess({ preview, restartToken: result.restartToken })
      if (result.action === 'install' && viewRef.current === 'installable') {
        void loadInstallable(false, appliedInstallableQuery, installableCategories)
      }
      if (result.action === 'uninstall' && viewRef.current === 'installed') {
        void loadInstallations()
      }
    } catch (cause) {
      if (request.signal.aborted || operationRequest.current !== request) return
      setOperationExecutionFailed(true)
      setOperationErrorDetailsValue(operationErrorDetails(cause))
      if (isDesktopUnavailable(cause)) {
        setInstallationsUnavailable(true)
        setInstallationsError(t('desktopUnavailable'))
        setOperationError(t('desktopUnavailable'))
      } else {
        setOperationError(operationErrorMessage(cause, t('executeError')))
      }
    } finally {
      if (operationRequest.current === request) {
        operationRequest.current = undefined
        operationStage.current = undefined
        setOperationPending(false)
      }
    }
  }

  const runDesktopAction = async (action: 'open-terminal' | 'request-restart', restartToken?: string) => {
    if (desktopActionRequest.current !== undefined) return
    const request = new AbortController()
    desktopActionRequest.current = request
    setDesktopActionPending(true)
    setDesktopActionError(undefined)
    try {
      if (action === 'open-terminal') await openMarketTerminal(request.signal)
      else if (restartToken !== undefined) await requestMarketRestart(restartToken, request.signal)
      else throw new Error('restart token missing')
    } catch (cause) {
      if (request.signal.aborted || desktopActionRequest.current !== request) return
      setDesktopActionError(t(isDesktopUnavailable(cause)
        ? 'desktopActionUnavailable'
        : action === 'open-terminal' ? 'terminalError' : 'restartError'))
    } finally {
      if (desktopActionRequest.current === request) {
        desktopActionRequest.current = undefined
        setDesktopActionPending(false)
      }
    }
  }

  return (
    <section
      className="dshMarketRoot"
      aria-label={t('title')}
      aria-busy={loading || loadingMore || mutationPending || installationsLoading || internalLoading || internalTicketPending || operationPending || desktopActionPending}
    >
      {showHeader && (
        <header className="dshMarketHeader">
          <div className="dshMarketHeaderTitle">
            <h2>{t('title')}</h2>
            <p>{t('subtitle')}</p>
          </div>
        </header>
      )}
      <div className="dshMarketViewBar">
        <div className="dshMarketViewSwitch" role="group" aria-label={t('title')}>
          <Pill active={view === 'discover'} aria-pressed={view === 'discover'} onClick={() => selectMarketView('discover')}>
            <IconDataOutline16 size={14} /><span>{t('discover')}</span>
          </Pill>
          <Pill active={view === 'installable'} aria-pressed={view === 'installable'} onClick={() => selectMarketView('installable')}>
            <IconDownloadOutline16 size={14} /><span>{t('installable')}</span>
          </Pill>
          <Pill active={view === 'installed'} aria-pressed={view === 'installed'} onClick={() => selectMarketView('installed')}>
            <IconCheckOutline16 size={14} /><span>{t('installed')}</span>
          </Pill>
          <Pill active={view === 'internal'} aria-pressed={view === 'internal'} onClick={() => selectMarketView('internal')}>
            <IconCordisPluginOutline14 size={14} /><span>{t('internalPlugins')}</span>
          </Pill>
          <Pill active={view === 'sources'} aria-pressed={view === 'sources'} onClick={() => selectMarketView('sources')}>
            <IconSettingsOutline16 size={14} /><span>{t('sources')}</span>
          </Pill>
        </div>
        <Pill className="dshMarketCurrentSource">
          {view === 'internal'
            ? t('internalSource')
            : currentSource === undefined
            ? t('noSourceSelected')
            : currentSourceHref === undefined
              ? `${t('currentSource')}: ${currentSource.name}`
              : (
                <a href={currentSourceHref} target="_blank" rel="noopener noreferrer">
                  {t('currentSource')}: {currentSource.name} <IconRightUpOutline16 size={12} />
                </a>
              )}
        </Pill>
      </div>
      <main className="dshMarketMain">
        {view === 'discover' ? (
          <DiscoverView
            state={state}
            items={items}
            metadata={catalog?.metadata}
            query={query}
            categoryOptions={categoryOptions}
            selectedCategories={selectedCategories}
            loading={loading}
            loadingMore={loadingMore}
            mutationPending={mutationPending}
            error={error}
            loadMoreError={loadMoreError}
            partialFailure={partialFailure}
            onQuery={setQuery}
            onSearch={() => state !== undefined && void loadCatalog(state, query, selectedCategories)}
            onRefresh={() => void loadState(appliedQuery, selectedCategories, true)}
            onToggleCategory={toggleCategory}
            onLoadMore={() => { void loadMore() }}
            hasMore={pageTarget !== undefined}
            onSources={() => selectMarketView('sources')}
            onSelect={openItem}
            t={t}
          />
        ) : view === 'installable' ? (
          <InstallableView
            state={state}
            items={installableItems}
            totalItems={installableItems.length}
            query={installableQuery}
            categoryOptions={installableCategoryOptions}
            selectedCategories={installableCategories}
            metadata={installableIndex?.metadata}
            loaded={installableLoaded}
            loading={installableLoading}
            loadingMore={installableLoadingMore}
            hasMore={installableIndex?.nextCursor !== undefined}
            unavailable={installableUnavailable}
            error={installableError}
            operationPending={operationPending}
            onQuery={setInstallableQuery}
            onSearch={() => { void loadInstallable(false, installableQuery, installableCategories) }}
            onRefresh={() => { void loadInstallable(true, appliedInstallableQuery, installableCategories) }}
            onToggleCategory={category => {
              const nextCategories = installableCategories.includes(category)
                ? installableCategories.filter(value => value !== category)
                : [...installableCategories, category]
              void loadInstallable(false, appliedInstallableQuery, nextCategories)
            }}
            onLoadMore={() => {
              if (installableIndex?.nextCursor === undefined) return
              void loadInstallable(false, appliedInstallableQuery, installableCategories, {
                sourceRecordId: installableIndex.source.sourceRecordId,
                cursor: installableIndex.nextCursor,
              })
            }}
            onRetry={() => { void loadInstallable(false, appliedInstallableQuery, installableCategories) }}
            onSources={() => selectMarketView('sources')}
            onInstall={openItem}
            t={t}
          />
        ) : view === 'internal' ? (
          <InternalPluginsView
            index={internalIndex}
            query={internalQuery}
            loaded={internalLoaded}
            loading={internalLoading}
            error={internalError}
            ticketPending={internalTicketPending}
            locale={readLocale()}
            onQuery={setInternalQuery}
            onSearch={() => { void loadInternal(false, internalQuery) }}
            onRefresh={() => { void loadInternal(true, internalAppliedQuery) }}
            onRetry={() => { void loadInternal(false, internalAppliedQuery) }}
            onInstall={(plugin, versionId) => { void beginInternalInstall(plugin, versionId) }}
            onOpenProject={plugin => { void openInternalProject(plugin) }}
            t={t}
          />
        ) : view === 'installed' ? (
          <InstalledView
            installations={installations}
            loaded={installationsLoaded}
            loading={installationsLoading}
            unavailable={installationsUnavailable}
            error={installationsError ?? operationError}
            operationPending={operationPending}
            onRetry={() => { void loadInstallations() }}
            onUninstall={bundleId => {
              void beginOperationPreview({ action: 'uninstall', bundleId })
            }}
            t={t}
          />
        ) : (
          <SourcesView
            state={state}
            catalog={catalog}
            error={mutationError}
            pending={mutationPending}
            adapterGuideHref={catalogAdapterGuideUrl(readLocale())}
            onMutation={mutation => { void mutate(mutation) }}
            onAddStandard={() => setAddOpen(true)}
            t={t}
          />
        )}
      </main>
      {selected !== undefined && (
        <ItemActionModal
          value={selected}
          installation={selectedInstallation}
          inventoryLoading={selectedInventoryLoading}
          inventoryError={selectedInventoryError}
          manualInstall={selectedManualInstall}
          preview={operationPreview?.action === 'install' ? operationPreview : undefined}
          pending={operationPending}
          operationError={operationError}
          operationDetails={operationErrorDetailsValue}
          executionFailed={operationExecutionFailed}
          desktopActionError={desktopActionError}
          desktopActionPending={desktopActionPending}
          canOpenTerminal={state?.desktopActions.openTerminal === true}
          verificationHelpHref={installRequirementsUrl(readLocale())}
          onClose={closeItem}
          onConfirm={() => { void executePreview() }}
          onOpenTerminal={() => { void runDesktopAction('open-terminal') }}
          onUninstall={bundleId => {
            selectedKeyRef.current = undefined
            setSelected(undefined)
            setSelectedInstallation(undefined)
            void beginOperationPreview({ action: 'uninstall', bundleId })
          }}
          t={t}
        />
      )}
      {selected === undefined && operationPreview !== undefined && (
        <OperationConfirmModal
          preview={operationPreview}
          pending={operationPending}
          error={operationError}
          onCancel={() => {
            if (operationPending) return
            setOperationPreview(undefined)
            setOperationError(undefined)
            setOperationErrorDetailsValue(undefined)
            setOperationExecutionFailed(false)
          }}
          onConfirm={() => { void executePreview() }}
          t={t}
        />
      )}
      {selectedInternal !== undefined && operationPreview === undefined && (
        <InternalProjectModal
          plugin={selectedInternal}
          locale={readLocale()}
          pending={internalTicketPending}
          loading={selectedInternalLoading}
          error={selectedInternalError}
          onClose={() => {
            if (internalTicketPending) return
            selectedInternalRequest.current?.abort()
            selectedInternalRequest.current = undefined
            setSelectedInternalLoading(false)
            setSelectedInternal(undefined)
          }}
          onInstall={versionId => { void beginInternalInstall(selectedInternal, versionId) }}
          t={t}
        />
      )}
      {operationSuccess !== undefined && (
        <OperationSuccessModal
          operation={operationSuccess}
          canRestart={state?.desktopActions.requestRestart === true}
          pending={desktopActionPending}
          error={desktopActionError}
          onClose={() => setOperationSuccess(undefined)}
          onRestart={() => { void runDesktopAction('request-restart', operationSuccess.restartToken) }}
          t={t}
        />
      )}
      <Modal
        open={addOpen}
        className="dshMarketModal dshMarketSourceModal"
        contentClassName="dshMarketModalContent"
        onClose={() => { if (!mutationPending) setAddOpen(false) }}
        title={t('addStandard')}
        closeLabel={t('cancel')}
        description={t('sourceNotice')}
        footer={<div className="dshMarketModalActions">
          <Button variant="ghost" disabled={mutationPending} onClick={() => setAddOpen(false)}>{t('cancel')}</Button>
          <Button
            variant="primary"
            icon={<IconPlusOutline16 />}
            disabled={mutationPending || !manifestUrl.trim()}
            onClick={() => {
              void mutate({ action: 'add-standard', manifestUrl: manifestUrl.trim() }).then(succeeded => {
                if (!succeeded) return
                setManifestUrl('')
                setAddOpen(false)
              })
            }}
          >{t('confirmAdd')}</Button>
        </div>}
      >
        <div className="dshMarketModalField">
          <label htmlFor="dsh-market-manifest">{t('standardSource')}</label>
          <Input
            id="dsh-market-manifest"
            value={manifestUrl}
            disabled={mutationPending}
            placeholder={t('manifestPlaceholder')}
            onChange={event => setManifestUrl(event.currentTarget.value)}
          />
          {mutationError !== undefined && <div className="dshMarketError" role="alert">{mutationError}</div>}
        </div>
      </Modal>
    </section>
  )
}

export function MarketSettingsTab({ initialView, readLocale, t }: MarketSettingsTabProps) {
  return <MarketSurface
    {...(initialView === undefined ? {} : { initialView })}
    readLocale={readLocale}
    t={t}
  />
}

function InternalPluginsView(props: {
  index?: MarketInternalPluginsResponse | undefined
  query: string
  locale: string
  loaded: boolean
  loading: boolean
  error?: string | undefined
  ticketPending: boolean
  onQuery: (value: string) => void
  onSearch: () => void
  onRefresh: () => void
  onRetry: () => void
  onInstall: (plugin: MarketInternalPlugin, versionId?: number) => void
  onOpenProject: (plugin: MarketInternalPlugin) => void
  t: MarketSettingsTabProps['t']
}) {
  const chinese = props.locale.toLowerCase().startsWith('zh')
  const [selectedVersions, setSelectedVersions] = useState<Record<string, number>>({})
  if (!props.loaded && props.loading) return (
    <div className="dshMarketEmpty"><StateDot state="ongoing" size={16} /><p>{props.t('internalLoading')}</p></div>
  )
  if (!props.loaded && props.error !== undefined) return (
    <div className="dshMarketEmpty" role="alert">
      <StateDot state="error" size={14} />
      <h2>{props.t('internalUnavailableTitle')}</h2>
      <p>{props.error}</p>
      <Button variant="outline" icon={<IconRefreshOutline16 />} onClick={props.onRetry}>{props.t('retry')}</Button>
    </div>
  )
  const plugins = props.index?.plugins ?? []
  return (
    <div className="dshMarketContent dshMarketInternalContent">
      <div className="dshMarketInternalBanner">
        <div className="dshMarketInternalBannerIcon"><IconCordisPluginOutline14 size={18} /></div>
        <div>
          <strong>{props.t('internalAccessTitle')}</strong>
          <p>{props.t('internalAccessBody')}</p>
          {props.index?.identity !== undefined && (
            <small>{props.t('internalSignedInAs')}: {props.index.identity.username} · {props.index.identity.groupName}</small>
          )}
        </div>
      </div>
      <div className="dshMarketSectionHead">
        <div><h2>{props.t('internalPlugins')}</h2><p>{props.t('internalPluginsBody')}</p></div>
        <Button variant="outline" size="sm" disabled={props.loading || props.ticketPending} icon={<IconRefreshOutline16 />} onClick={props.onRefresh}>{props.t('refresh')}</Button>
      </div>
      <form className="dshMarketToolbar" onSubmit={event => { event.preventDefault(); props.onSearch() }}>
        <Input
          className="dshMarketSearch"
          icon={<IconSearchOutline16 />}
          value={props.query}
          disabled={props.loading || props.ticketPending}
          placeholder={props.t('internalSearch')}
          onChange={event => props.onQuery(event.currentTarget.value)}
        />
        <Button type="submit" variant="primary" disabled={props.loading || props.ticketPending} icon={<IconSearchOutline16 />}>{props.t('searchAction')}</Button>
        <Pill>{props.index?.total ?? plugins.length}</Pill>
      </form>
      {props.error !== undefined && <div className="dshMarketBanner" role="alert"><StateDot state="error" />{props.error}</div>}
      {plugins.length === 0 ? (
        <div className="dshMarketEmpty"><h2>{props.t('internalNoPlugins')}</h2><p>{props.t('internalNoPluginsBody')}</p></div>
      ) : (
        <div className="dshMarketInternalGrid">
          {plugins.map(plugin => (
            <article className="dshMarketInternalCard" key={plugin.id}>
              <div className="dshMarketCardTop">
                <div className="dshMarketInternalGlyph"><IconCordisPluginOutline14 size={22} /></div>
                <div className="dshMarketCardName"><strong>{plugin.name}</strong><span>{plugin.id}</span></div>
              </div>
              <p className="dshMarketSummary">{chinese ? plugin.description.zh : plugin.description.en}</p>
              <div className="dshMarketTags">
                <Pill>{plugin.category}</Pill>
                <Pill>{plugin.ownerUsername}</Pill>
                {plugin.version !== undefined && <Pill>v{plugin.version}</Pill>}
              </div>
              {plugin.versions !== undefined && plugin.versions.length > 0 && (
                <label className="dshMarketInternalVersionPicker">
                  <span>{chinese ? '安装版本' : 'Version'}</span>
                  <select
                    value={selectedVersions[plugin.id] ?? plugin.versions.find(version => version.isCurrent)?.id ?? plugin.versions[0]!.id}
                    disabled={props.ticketPending}
                    onChange={event => setSelectedVersions(current => ({ ...current, [plugin.id]: Number(event.currentTarget.value) }))}
                  >
                    {plugin.versions.map(version => (
                      <option key={version.id} value={version.id}>
                        {version.version === undefined ? version.sourceCommit ?? `#${version.id}` : `v${version.version}`}
                        {version.isCurrent ? (chinese ? '（当前）' : ' (current)') : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="dshMarketInternalCardActions">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={props.ticketPending}
                  onClick={() => props.onInstall(plugin, selectedVersions[plugin.id] ?? plugin.versions?.find(version => version.isCurrent)?.id)}
                >{props.ticketPending ? '…' : (plugin.versions !== undefined && plugin.versions.length > 1 ? props.t('internalInstallVersion') : props.t('internalOneClickInstall'))}</Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={props.ticketPending}
                  onClick={() => props.onOpenProject(plugin)}
                >{props.t('projectIntro')}</Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function InternalProjectModal({ plugin, locale, pending, loading, error, onClose, onInstall, t }: {
  plugin: MarketInternalPlugin
  locale: string
  pending: boolean
  loading: boolean
  error?: string | undefined
  onClose: () => void
  onInstall: (versionId?: number) => void
  t: MarketSettingsTabProps['t']
}) {
  const chinese = locale.toLowerCase().startsWith('zh')
  const description = chinese ? plugin.description.zh : plugin.description.en
  const versions = plugin.versions ?? []
  const [selectedVersionId, setSelectedVersionId] = useState<number | undefined>(
    plugin.versions?.find(version => version.isCurrent)?.id ?? plugin.versions?.[0]?.id,
  )
  return (
    <Modal
      open
      className="dshMarketModal dshMarketWideModal"
      contentClassName="dshMarketModalContent"
      onClose={onClose}
      title={plugin.name}
      closeLabel={t('close')}
      description={t('internalProjectBody')}
      footer={<div className="dshMarketModalActions">
        <Button variant="ghost" disabled={pending} onClick={onClose}>{t('close')}</Button>
        <Button
          variant="primary"
          icon={<IconDownloadOutline16 />}
          disabled={pending}
          onClick={() => onInstall(selectedVersionId)}
        >{pending ? t('installing') : (versions.length > 1 ? t('internalInstallVersion') : t('internalOneClickInstall'))}</Button>
      </div>}
    >
      <div className="dshMarketDetails dshMarketInternalProject">
        <div className="dshMarketDetailsIntro">
          <div className="dshMarketInternalGlyph"><IconCordisPluginOutline14 size={28} /></div>
          {loading ? <p>{t('loading')}</p> : plugin.readme !== undefined ? (
            <pre className="dshMarketInternalReadme">{plugin.readme}</pre>
          ) : <p>{description}</p>}
        </div>
        <dl className="dshMarketOperationFacts">
          <div><dt>{t('pluginId')}</dt><dd>{plugin.id}</dd></div>
          <div><dt>{t('category')}</dt><dd>{plugin.category}</dd></div>
          <div><dt>{t('owner')}</dt><dd>{plugin.ownerUsername}</dd></div>
          {plugin.approvedCommit !== null && <div><dt>{t('approvedCommit')}</dt><dd>{plugin.approvedCommit}</dd></div>}
          {versions.length > 0 && <div>
            <dt>{chinese ? '安装版本' : 'Version'}</dt>
            <dd>
              <select
                value={selectedVersionId ?? ''}
                disabled={pending}
                onChange={event => setSelectedVersionId(Number(event.currentTarget.value))}
              >
                {versions.map(version => <option key={version.id} value={version.id}>{version.version ?? version.sourceCommit ?? `#${version.id}`}{version.isCurrent ? (chinese ? '（当前）' : ' (current)') : ''}</option>)}
              </select>
            </dd>
          </div>}
        </dl>
        {error !== undefined && <div className="dshMarketError" role="alert">{error}</div>}
      </div>
    </Modal>
  )
}

function DiscoverView(props: {
  state?: MarketStateResponse | undefined
  items: readonly VisibleItem[]
  metadata: MarketCatalogResponse['metadata']
  query: string
  categoryOptions: readonly string[]
  selectedCategories: readonly string[]
  loading: boolean
  loadingMore: boolean
  mutationPending: boolean
  error?: string | undefined
  loadMoreError?: string | undefined
  partialFailure: boolean
  hasMore: boolean
  onQuery: (value: string) => void
  onSearch: () => void
  onRefresh: () => void
  onToggleCategory: (category: string) => void
  onLoadMore: () => void
  onSources: () => void
  onSelect: (value: VisibleItem) => void
  t: MarketSettingsTabProps['t']
}) {
  const noSources = props.state !== undefined && !props.state.sources.some(source => source.enabled)
  if (noSources) return (
    <div className="dshMarketEmpty">
      <div className="dshMarketEmptyIcon"><IconGlobeOutline14 size={24} /></div>
      <h2>{props.t('emptyTitle')}</h2>
      <p>{props.t('emptyBody')}</p>
      <Button variant="primary" icon={<IconSettingsOutline16 />} onClick={props.onSources}>{props.t('chooseSources')}</Button>
    </div>
  )
  return (
    <div className="dshMarketContent">
      {props.metadata !== undefined && (
        <div className="dshMarketIndexMeta" role="status">
          <span>{props.t('scannedAt')}: {props.metadata.scannedAt}</span>
          <span>{props.t('cacheExpiresAt')}: {props.metadata.expiresAt}</span>
          {props.metadata.providerRevision !== undefined && (
            <span>{props.t('providerRevision')}: {props.metadata.providerRevision}</span>
          )}
          <span>{props.metadata.cacheStatus === 'fresh' ? props.t('freshScan') : props.t('cachedScan')}</span>
        </div>
      )}
      <form className="dshMarketToolbar" onSubmit={event => { event.preventDefault(); props.onSearch() }}>
        <Input
          className="dshMarketSearch"
          icon={<IconSearchOutline16 />}
          value={props.query}
          disabled={props.mutationPending}
          placeholder={props.t('search')}
          onChange={event => props.onQuery(event.currentTarget.value)}
        />
        <Button type="submit" variant="primary" disabled={props.mutationPending} icon={<IconSearchOutline16 />}>{props.t('searchAction')}</Button>
        <Tooltip label={props.t('refresh')}>
          <Button
            type="button"
            size="sm"
            variant="toolbar"
            aria-label={props.t('refresh')}
            disabled={props.loading || props.loadingMore || props.mutationPending}
            icon={<IconRefreshOutline16 />}
            onClick={props.onRefresh}
          />
        </Tooltip>
        <Pill>{props.items.length}</Pill>
      </form>
      {props.categoryOptions.length > 0 && (
        <div className="dshMarketCategories" role="group" aria-label={props.t('categories')}>
          <span>{props.t('categories')}</span>
          {props.categoryOptions.map(category => (
            <Pill
              key={category}
              active={props.selectedCategories.includes(category)}
              aria-pressed={props.selectedCategories.includes(category)}
              disabled={props.mutationPending}
              onClick={() => props.onToggleCategory(category)}
            >{category}</Pill>
          ))}
        </div>
      )}
      {props.partialFailure && <div className="dshMarketBanner" role="status"><StateDot state="warning" />{props.t('partialFailure')}</div>}
      {props.error !== undefined && (
        <div className="dshMarketEmpty" role="alert">
          <StateDot state="error" size={14} />
          <h2>{props.t('catalogError')}</h2><p>{props.error}</p>
          <Button variant="outline" icon={<IconRefreshOutline16 />} onClick={props.onRefresh}>{props.t('retry')}</Button>
        </div>
      )}
      {props.error === undefined && props.loading && props.items.length === 0 && (
        <div className="dshMarketEmpty"><StateDot state="ongoing" size={16} /><p>{props.t('loading')}</p></div>
      )}
      {props.error === undefined && !props.loading && props.items.length === 0 && (
        <div className="dshMarketEmpty"><h2>{props.t('noResults')}</h2></div>
      )}
      <div className="dshMarketGrid">
        {props.items.map(value => <PluginCard key={`${value.source.sourceRecordId}:${value.item.id}`} value={value} onClick={() => props.onSelect(value)} t={props.t} />)}
      </div>
      {(props.hasMore || props.loadMoreError !== undefined) && (
        <div className="dshMarketPagination">
          {props.loadMoreError !== undefined && <div className="dshMarketPaginationError" role="status">{props.loadMoreError}</div>}
          {props.hasMore && (
            <Button
              type="button"
              variant="outline"
              disabled={props.loading || props.loadingMore || props.mutationPending}
              onClick={props.onLoadMore}
            >{props.loadingMore ? props.t('loadingMore') : props.t('loadMore')}</Button>
          )}
        </div>
      )}
    </div>
  )
}

function InstallableView(props: {
  state?: MarketStateResponse | undefined
  items: readonly VisibleItem[]
  totalItems: number
  query: string
  categoryOptions: readonly string[]
  selectedCategories: readonly string[]
  metadata: MarketInstallableResponse['metadata'] | undefined
  loaded: boolean
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  unavailable: boolean
  error?: string | undefined
  operationPending: boolean
  onQuery: (value: string) => void
  onSearch: () => void
  onRefresh: () => void
  onToggleCategory: (category: string) => void
  onLoadMore: () => void
  onRetry: () => void
  onSources: () => void
  onInstall: (value: VisibleItem) => void
  t: MarketSettingsTabProps['t']
}) {
  const noSources = props.state !== undefined && !props.state.sources.some(source => source.enabled)
  if (noSources) return (
    <div className="dshMarketEmpty">
      <div className="dshMarketEmptyIcon"><IconGlobeOutline14 size={24} /></div>
      <h2>{props.t('emptyTitle')}</h2>
      <p>{props.t('emptyBody')}</p>
      <Button variant="primary" icon={<IconSettingsOutline16 />} onClick={props.onSources}>{props.t('chooseSources')}</Button>
    </div>
  )
  if (props.unavailable) return (
    <div className="dshMarketEmpty" role="status">
      <StateDot state="warning" size={16} />
      <h2>{props.t('desktopRequiredTitle')}</h2>
      <p>{props.t('desktopUnavailable')}</p>
    </div>
  )
  if (props.loading) return (
    <div className="dshMarketEmpty"><StateDot state="ongoing" size={16} /><p>{props.t('scanningInstallable')}</p></div>
  )
  if (!props.loaded && props.error !== undefined) return (
    <div className="dshMarketEmpty" role="alert">
      <StateDot state="error" size={14} />
      <h2>{props.t('installableError')}</h2>
      <Button variant="outline" icon={<IconRefreshOutline16 />} onClick={props.onRetry}>{props.t('retry')}</Button>
    </div>
  )
  if (!props.loaded) return (
    <div className="dshMarketEmpty"><StateDot state="ongoing" size={16} /><p>{props.t('scanningInstallable')}</p></div>
  )
  return (
    <div className="dshMarketContent">
      <div className="dshMarketSectionHead">
        <div><h2>{props.t('installable')}</h2><p>{props.t('installableBody')}</p></div>
        <Button
          variant="outline"
          size="sm"
          disabled={props.loading || props.operationPending}
          icon={<IconRefreshOutline16 />}
          onClick={props.onRefresh}
        >{props.t('rescanInstallable')}</Button>
      </div>
      {props.metadata !== undefined && (
        <div className="dshMarketIndexMeta" role="status">
          <span>{props.t('scannedAt')}: {props.metadata.scannedAt}</span>
          {props.metadata.providerRevision !== undefined && (
            <span>{props.t('providerRevision')}: {props.metadata.providerRevision}</span>
          )}
          <span>{props.metadata.cacheStatus === 'fresh' ? props.t('freshScan') : props.t('cachedScan')}</span>
        </div>
      )}
      <form className="dshMarketToolbar" onSubmit={event => { event.preventDefault(); props.onSearch() }}>
        <Input
          className="dshMarketSearch"
          icon={<IconSearchOutline16 />}
          value={props.query}
          disabled={props.operationPending}
          placeholder={props.t('search')}
          onChange={event => props.onQuery(event.currentTarget.value)}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={props.operationPending}
          icon={<IconSearchOutline16 />}
        >{props.t('searchAction')}</Button>
        <Pill>{props.totalItems}</Pill>
      </form>
      {props.categoryOptions.length > 0 && (
        <div className="dshMarketCategories" role="group" aria-label={props.t('categories')}>
          <span>{props.t('categories')}</span>
          {props.categoryOptions.map(category => (
            <Pill
              key={category}
              active={props.selectedCategories.includes(category)}
              aria-pressed={props.selectedCategories.includes(category)}
              disabled={props.operationPending}
              onClick={() => props.onToggleCategory(category)}
            >{category}</Pill>
          ))}
        </div>
      )}
      {props.error !== undefined && (
        <div className="dshMarketBanner" role="alert">
          <StateDot state="error" />
          <span>{props.error}</span>
        </div>
      )}
      {props.items.length === 0 && !props.hasMore && (
        <div className="dshMarketEmpty"><h2>{props.t('noInstallable')}</h2><p>{props.t('noInstallableBody')}</p></div>
      )}
      <div className="dshMarketGrid">
        {props.items.map(value => (
          <PluginCard
            key={`${value.source.sourceRecordId}:${value.item.id}`}
            value={value}
            actionLabel={props.t('install')}
            disabled={props.operationPending}
            onClick={() => props.onInstall(value)}
            t={props.t}
          />
        ))}
      </div>
      {props.hasMore && (
        <div className="dshMarketPagination">
          <Button
            type="button"
            variant="outline"
            disabled={props.operationPending || props.loadingMore}
            onClick={props.onLoadMore}
          >{props.loadingMore ? props.t('loadingMore') : props.t('loadMore')}</Button>
        </div>
      )}
    </div>
  )
}

function InstalledView(props: {
  installations: readonly MarketInstallationView[]
  loaded: boolean
  loading: boolean
  unavailable: boolean
  error?: string | undefined
  operationPending: boolean
  onRetry: () => void
  onUninstall: (bundleId: string) => void
  t: MarketSettingsTabProps['t']
}) {
  if (props.unavailable) return (
    <div className="dshMarketEmpty" role="status">
      <StateDot state="warning" size={16} />
      <h2>{props.t('desktopRequiredTitle')}</h2>
      <p>{props.t('desktopUnavailable')}</p>
    </div>
  )
  if (!props.loaded && props.loading) return (
    <div className="dshMarketEmpty"><StateDot state="ongoing" size={16} /><p>{props.t('loadingInstallations')}</p></div>
  )
  if (!props.loaded && props.error !== undefined) return (
    <div className="dshMarketEmpty" role="alert">
      <StateDot state="error" size={14} />
      <h2>{props.t('installationsError')}</h2>
      <Button variant="outline" icon={<IconRefreshOutline16 />} onClick={props.onRetry}>{props.t('retry')}</Button>
    </div>
  )
  return (
    <div className="dshMarketContent">
      <div className="dshMarketSectionHead">
        <div><h2>{props.t('installed')}</h2><p>{props.t('installedBody')}</p></div>
        <Button
          variant="outline"
          size="sm"
          disabled={props.loading || props.operationPending}
          icon={<IconRefreshOutline16 />}
          onClick={props.onRetry}
        >{props.t('refresh')}</Button>
      </div>
      {props.error !== undefined && <div className="dshMarketBanner" role="alert"><StateDot state="error" />{props.error}</div>}
      {props.installations.length === 0 ? (
        <div className="dshMarketEmpty"><h2>{props.t('noInstalled')}</h2><p>{props.t('noInstalledBody')}</p></div>
      ) : (
        <div className="dshMarketReceipts">
          {props.installations.map(installation => (
            <InstallationCard
              key={installation.bundleId}
              installation={installation}
              operationPending={props.operationPending}
              onUninstall={props.onUninstall}
              t={props.t}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function InstallationCard(props: {
  installation: MarketInstallationView
  operationPending: boolean
  onUninstall: (bundleId: string) => void
  t: MarketSettingsTabProps['t']
}) {
  const { installation } = props
  const packageName = installation.packageName
  const displayName = packageName
  return (
    <article className="dshMarketReceipt">
      <div className="dshMarketReceiptMain">
        <div className="dshMarketReceiptTitle">
          <StateDot state={installation.status === 'disabled' ? 'warning' : 'done'} size={10} />
          <h3>{displayName}</h3>
          <Pill>{props.t('profileDependency')}</Pill>
          <Pill>{props.t(installation.status === 'disabled' ? 'disabledPlugin' : 'activePlugin')}</Pill>
        </div>
        <div className="dshMarketReceiptMeta">
          <span>{packageName}</span>
          {installation.status === 'disabled' && <span>{props.t('disabledRestartRequired')}</span>}
        </div>
      </div>
      <div className="dshMarketReceiptActions">
        {installation.action === 'uninstall' && <Button
          variant="outline"
          size="sm"
          aria-label={`${props.t('uninstall')}: ${displayName}`}
          disabled={props.operationPending}
          icon={<IconTrashOutline16 />}
          onClick={() => props.onUninstall(installation.bundleId)}
        >{props.t('uninstall')}</Button>}
      </div>
    </article>
  )
}

function sourceDisplayLabel(source: MarketSourceView): string {
  const attribution = source.attribution?.name
  return attribution === undefined || attribution === source.name
    ? source.name
    : `${source.name} · ${attribution}`
}

function safeHttpsExternalHref(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) {
      return undefined
    }
    return url.href
  } catch {
    return undefined
  }
}

function PluginCard({ value, actionLabel, disabled = false, onClick, t }: {
  value: VisibleItem
  actionLabel?: string | undefined
  disabled?: boolean
  onClick: () => void
  t: MarketSettingsTabProps['t']
}) {
  const publisher = value.item.publisher?.name ?? value.source.name
  const sourceLabel = sourceDisplayLabel(value.source)
  return (
    <button
      type="button"
      className="dshMarketCard"
      aria-haspopup="dialog"
      aria-label={actionLabel === undefined ? undefined : `${actionLabel}: ${value.item.displayName}`}
      disabled={disabled}
      onClick={onClick}
    >
      <div className="dshMarketCardTop">
        <PluginIcon item={value.item} />
        <div className="dshMarketCardName"><strong>{value.item.displayName}</strong><span>{publisher}</span></div>
      </div>
      <p className="dshMarketSummary">{value.item.summary}</p>
      <div className="dshMarketTags">
        <Pill>{t('source')}: {sourceLabel}</Pill>
        {actionLabel !== undefined && <Pill>{actionLabel}</Pill>}
        {value.stale && <Pill>{t('stale')}</Pill>}
        {value.item.categories?.slice(0, 2).map(category => <Pill key={category}>{category}</Pill>)}
      </div>
    </button>
  )
}

function SourceAttribution({ attribution }: {
  attribution: NonNullable<MarketSourceView['attribution']>
}) {
  const href = safeHttpsExternalHref(attribution.url)
  return (
    <div className="dshMarketSourceAttribution">
      {href === undefined
        ? <span>{attribution.name}</span>
        : <a href={href} target="_blank" rel="noopener noreferrer">{attribution.name}</a>}
      {attribution.notice !== undefined && <span>{attribution.notice}</span>}
    </div>
  )
}

function ItemSourceRow({ source, t }: {
  source: MarketSourceView
  t: MarketSettingsTabProps['t']
}) {
  const label = sourceDisplayLabel(source)
  const href = safeHttpsExternalHref(source.homepage)
    ?? safeHttpsExternalHref(source.attribution?.url)
  return (
    <div className="dshMarketItemSourceRow">
      <span>{t('source')}:</span>
      {href === undefined
        ? <span>{label}</span>
        : (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${t('source')}: ${label}`}
          >
            {label} <IconRightUpOutline16 size={12} />
          </a>
        )}
    </div>
  )
}

function SourcesView({ state, catalog, error, pending, adapterGuideHref, onMutation, onAddStandard, t }: {
  state?: MarketStateResponse | undefined
  catalog?: MarketCatalogResponse | undefined
  error?: string | undefined
  pending: boolean
  adapterGuideHref: string
  onMutation: (mutation: MarketSourceMutation) => void
  onAddStandard: () => void
  t: MarketSettingsTabProps['t']
}) {
  const selectedKeys = new Set(state?.sources.map(source => source.builtInProviderKey).filter(Boolean))
  const available = state?.builtIns.filter(provider => !selectedKeys.has(provider.key)) ?? []
  return (
    <div className="dshMarketContent">
      <div className="dshMarketSectionHead">
        <div><h2>{t('sources')}</h2><p>{t('sourceNotice')}</p></div>
        <Button variant="outline" disabled={pending} icon={<IconPlusOutline16 />} onClick={onAddStandard}>{t('addStandard')}</Button>
      </div>
      <div className="dshMarketBanner dshMarketSourceGuide">
        <IconGlobeOutline14 size={14} />
        <span>
          {t('sourcePartnershipBefore')}
          <a href={DSH_DESKTOP_ISSUES_URL} target="_blank" rel="noopener noreferrer">{t('sourcePartnershipContact')}</a>
          {t('sourcePartnershipAfter')}{' '}
          <a href={adapterGuideHref} target="_blank" rel="noopener noreferrer">{t('sourcePartnershipGuide')}</a>
        </span>
      </div>
      {error !== undefined && <div className="dshMarketBanner" role="alert"><StateDot state="error" />{error}</div>}
      <div className="dshMarketSources" role="radiogroup" aria-label={t('sourceSelection')}>
        {state?.sources.map((source, index, sources) => (
          <SourceRow
            key={source.sourceRecordId}
            source={source}
            result={catalog?.results.find(result => result.source.sourceRecordId === source.sourceRecordId)}
            pending={pending}
            canMoveUp={index > 0}
            canMoveDown={index < sources.length - 1}
            onMoveUp={() => onMutation({ action: 'move', sourceRecordId: source.sourceRecordId, direction: 'up' })}
            onMoveDown={() => onMutation({ action: 'move', sourceRecordId: source.sourceRecordId, direction: 'down' })}
            onSelect={() => {
              if (!source.enabled) onMutation({ action: 'select', sourceRecordId: source.sourceRecordId })
            }}
            onRemove={() => onMutation({ action: 'remove', sourceRecordId: source.sourceRecordId })}
            t={t}
          />
        ))}
      </div>
      {available.length > 0 && <div className="dshMarketSources dshMarketAvailableSources">
        {available.map(provider => (
          <AvailableSource
            key={provider.key}
            provider={provider}
            pending={pending}
            onAdd={() => onMutation({ action: 'add-builtin', key: provider.key })}
            t={t}
          />
        ))}
      </div>}
    </div>
  )
}

function SourceRow({ source, result, pending, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onSelect, onRemove, t }: {
  source: MarketSourceView
  result?: MarketCatalogSourceResult | undefined
  pending: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onSelect: () => void
  onRemove: () => void
  t: MarketSettingsTabProps['t']
}) {
  const endpointHost = (() => {
    try { return new URL(source.endpoint).host }
    catch { return source.endpoint }
  })()
  const resultLabel = result === undefined
    ? t('notChecked')
    : result.error !== undefined && result.snapshot === undefined
      ? t('unavailable')
      : result.stale
        ? t('lastStale')
        : t('available')
  const resultState = result === undefined
    ? 'ongoing'
    : result.error !== undefined && result.snapshot === undefined
      ? 'error'
      : result.stale
        ? 'warning'
        : 'done'
  return (
    <div className="dshMarketSource">
      <div>
        <h3>{source.name}{source.partnership && <Pill>{t('partner')}</Pill>}</h3>
        <p>{source.description ?? source.endpoint}</p>
        {source.attribution !== undefined && <SourceAttribution attribution={source.attribution} />}
        <div className="dshMarketSourceMeta">
          {source.attribution === undefined && <span>{source.providerId}</span>}
          <span>{endpointHost}</span>
          <span>{source.registrationKind === 'built-in' ? t('builtIn') : t('standardAdapter')}</span>
          <span><StateDot state={resultState} size={10} />{resultLabel}</span>
        </div>
      </div>
      <div className="dshMarketSourceActions">
        <Tooltip label={t('moveUp')}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('moveUp')}
            disabled={pending || !canMoveUp}
            icon={<IconChevronUpOutline14 />}
            onClick={onMoveUp}
          />
        </Tooltip>
        <Tooltip label={t('moveDown')}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('moveDown')}
            disabled={pending || !canMoveDown}
            icon={<IconChevronDownOutline14 />}
            onClick={onMoveDown}
          />
        </Tooltip>
        <Button
          variant="outline"
          size="sm"
          role="radio"
          aria-checked={source.enabled}
          disabled={pending}
          icon={source.enabled ? <IconCheckOutline16 /> : undefined}
          onClick={onSelect}
        >{source.enabled ? t('selectedSource') : t('selectSource')}</Button>
        <Tooltip label={t('remove')}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('remove')}
            disabled={pending}
            icon={<IconTrashOutline16 />}
            onClick={onRemove}
          />
        </Tooltip>
      </div>
    </div>
  )
}

function AvailableSource({ provider, pending, onAdd, t }: {
  provider: MarketBuiltInProvider
  pending: boolean
  onAdd: () => void
  t: MarketSettingsTabProps['t']
}) {
  return (
    <div className="dshMarketSource">
      <div>
        <h3>{provider.name}{provider.partnership && <Pill>{t('partner')}</Pill>}</h3>
        <p>{provider.description}</p>
        <SourceAttribution attribution={provider.attribution} />
      </div>
      <Button variant="outline" size="sm" disabled={pending} icon={<IconPlusOutline16 />} onClick={onAdd}>{t('add')}</Button>
    </div>
  )
}

function OperationFacts({ operation, showExpiry = true, t }: {
  operation: MarketOperationPreviewResponse
  showExpiry?: boolean
  t: MarketSettingsTabProps['t']
}) {
  return (
    <dl className="dshMarketOperationFacts">
      <div><dt>{t('plugin')}</dt><dd>{operation.displayName}</dd></div>
      <div><dt>{t('package')}</dt><dd>{operation.packageName}</dd></div>
      {operation.version !== undefined && <div><dt>{t('exactVersion')}</dt><dd>{operation.version}</dd></div>}
      <div><dt>{t('profile')}</dt><dd>{operation.profileName}</dd></div>
      {showExpiry && <div><dt>{t('previewExpires')}</dt><dd>{operation.expiresAt}</dd></div>}
    </dl>
  )
}

function OperationConfirmModal({ preview, pending, error, onCancel, onConfirm, t }: {
  preview: MarketOperationPreviewResponse
  pending: boolean
  error?: string | undefined
  onCancel: () => void
  onConfirm: () => void
  t: MarketSettingsTabProps['t']
}) {
  const installing = preview.action === 'install'
  const title = installing
    ? t('confirmInstallTitle')
    : t('confirmUninstallTitle')
  const description = installing
    ? t('confirmInstallBody')
    : t('confirmUninstallBody')
  const confirmLabel = pending
    ? installing
      ? t('installing')
      : t('uninstalling')
    : installing
      ? t('confirmInstall')
      : t('confirmUninstall')
  return (
    <Modal
      open
      className="dshMarketModal dshMarketConfirmModal"
      contentClassName="dshMarketModalContent"
      onClose={onCancel}
      closeLabel={t('cancel')}
      title={title}
      description={description}
      footer={<div className="dshMarketModalActions">
        <Button variant="ghost" disabled={pending} onClick={onCancel}>{t('cancel')}</Button>
        <Button
          variant="primary"
          disabled={pending}
          icon={installing ? <IconDownloadOutline16 /> : <IconTrashOutline16 />}
          onClick={onConfirm}
        >{confirmLabel}</Button>
      </div>}
    >
      <div className="dshMarketOperationReview">
        <OperationFacts operation={preview} t={t} />
        {installing && <div className="dshMarketOperationWarning"><StateDot state="warning" size={12} /><span>{t('operationWarning')}</span></div>}
        {installing && (
          <div className="dshMarketOperationWarning">
            <StateDot state="warning" size={12} />
            <span>
              {t('operationRiskBeforeContact')}
              <a href={DSH_DESKTOP_ISSUES_URL} target="_blank" rel="noopener noreferrer">{t('contactUs')}</a>
              {t('operationRiskAfterContact')}
            </span>
          </div>
        )}
        <div className="dshMarketOperationWarning"><StateDot state="warning" size={12} /><span>{t('restartAfterOperation')}</span></div>
        {pending && <div className="dshMarketOperationProgress" role="status"><StateDot state="ongoing" size={12} />{confirmLabel}</div>}
        {error !== undefined && <div className="dshMarketError" role="alert">{error}</div>}
      </div>
    </Modal>
  )
}

function OperationSuccessModal({ operation, canRestart, pending, error, onClose, onRestart, t }: {
  operation: CompletedOperation
  canRestart: boolean
  pending: boolean
  error?: string | undefined
  onClose: () => void
  onRestart: () => void
  t: MarketSettingsTabProps['t']
}) {
  const title = operation.preview.action === 'install'
    ? t('installComplete')
    : t('uninstallComplete')
  return (
    <Modal
      open
      className="dshMarketModal dshMarketStatusModal"
      contentClassName="dshMarketModalContent"
      onClose={() => { if (!pending) onClose() }}
      closeLabel={t('close')}
      title={title}
      description={t('restartRequiredTitle')}
      footer={<div className="dshMarketModalActions">
        <Button variant="ghost" disabled={pending} onClick={onClose}>{t('restartLater')}</Button>
        <Button
          variant="primary"
          disabled={!canRestart || pending}
          icon={<IconRefreshOutline16 />}
          onClick={onRestart}
        >{pending ? t('restarting') : t('restartNow')}</Button>
      </div>}
    >
      <div className="dshMarketOperationReview">
        <OperationFacts operation={operation.preview} showExpiry={false} t={t} />
        <div className="dshMarketOperationSuccess" role="status">
          <StateDot state="done" size={12} />
          <span>{t('restartRequiredBody')}</span>
        </div>
        {error !== undefined && <div className="dshMarketError" role="alert">{error}</div>}
      </div>
    </Modal>
  )
}

function ItemActionModal({
  value,
  installation,
  inventoryLoading,
  inventoryError,
  manualInstall,
  preview,
  pending,
  operationError,
  operationDetails,
  executionFailed,
  desktopActionError,
  desktopActionPending,
  canOpenTerminal,
  verificationHelpHref,
  onClose,
  onConfirm,
  onOpenTerminal,
  onUninstall,
  t,
}: {
  value: VisibleItem
  installation: MarketInstallationView | undefined
  inventoryLoading: boolean
  inventoryError?: string | undefined
  manualInstall: ManualInstallHint | undefined
  preview: MarketOperationPreviewResponse | undefined
  pending: boolean
  operationError?: string | undefined
  operationDetails?: string | undefined
  executionFailed: boolean
  desktopActionError?: string | undefined
  desktopActionPending: boolean
  canOpenTerminal: boolean
  verificationHelpHref: string
  onClose: () => void
  onConfirm: () => void
  onOpenTerminal: () => void
  onUninstall: (bundleId: string) => void
  t: MarketSettingsTabProps['t']
}) {
  const checking = preview === undefined && pending && operationError === undefined
  const failureInstallCommand = preview === undefined
    ? undefined
    : preview.version === undefined
      ? `dsh plugin add ${preview.packageName}`
      : `dsh plugin add --save-exact ${preview.packageName}@${preview.version}`
  const footer = executionFailed ? <>
    {canOpenTerminal && (
      <Button
        variant="primary"
        disabled={desktopActionPending}
        onClick={onOpenTerminal}
      >{desktopActionPending ? t('openingTerminal') : t('openTerminal')}</Button>
    )}
    <Button variant="ghost" disabled={desktopActionPending} onClick={onClose}>{t('close')}</Button>
  </> : installation === undefined && preview !== undefined ? <>
    <Button variant="ghost" disabled={pending} onClick={onClose}>{t('cancel')}</Button>
    <Button
      variant="primary"
      disabled={pending}
      icon={<IconDownloadOutline16 />}
      onClick={onConfirm}
    >{pending ? t('installing') : t('confirmInstall')}</Button>
  </> : <>
    {marketProjectUrl(value) !== undefined ? (
      <Button
        variant="outline"
        icon={<IconRightUpOutline16 size={12} />}
        onClick={() => {
          const href = marketProjectUrl(value)
          if (href !== undefined) window.open(href, '_blank', 'noopener,noreferrer')
        }}
      >{t('projectPage')}</Button>
    ) : value.item.repository !== undefined && (
      <Button
        variant="outline"
        icon={<IconRightUpOutline16 size={12} />}
        onClick={() => window.open(value.item.repository!.url, '_blank', 'noopener,noreferrer')}
      >{t('repository')}</Button>
    )}
    {installation === undefined
      && !inventoryLoading
      && inventoryError === undefined
      && manualInstall !== undefined
      && canOpenTerminal && (
      <Button
        variant="primary"
        disabled={desktopActionPending}
        onClick={onOpenTerminal}
      >{desktopActionPending ? t('openingTerminal') : t('openTerminal')}</Button>
    )}
    <Button variant="ghost" disabled={desktopActionPending} onClick={onClose}>{t('close')}</Button>
  </>
  return (
    <Modal
      open
      className="dshMarketModal dshMarketWideModal"
      contentClassName="dshMarketModalContent"
      onClose={onClose}
      title={executionFailed ? t('installFailedTitle') : preview === undefined ? value.item.displayName : t('confirmInstallTitle')}
      closeLabel={t('close')}
      {...(executionFailed
        ? { description: t('installFailedBody') }
        : preview === undefined ? {} : { description: t('confirmInstallBody') })}
      footer={<div className="dshMarketModalActions">{footer}</div>}
    >
      <>
        <ItemSourceRow source={value.source} t={t} />
        {preview !== undefined && executionFailed ? (
          <div className="dshMarketOperationReview">
            <OperationFacts operation={preview} showExpiry={false} t={t} />
            <div className="dshMarketFailureSummary" role="alert">
              <StateDot state="error" size={12} />
              <span>{operationError ?? t('executeError')}</span>
            </div>
            <div className="dshMarketOperationWarning">
              <StateDot state="warning" size={12} />
              <span>{t('installFailureTerminalHint')}</span>
            </div>
            {failureInstallCommand !== undefined && (
              <div className="dshMarketCommand">
                <span>{t('installCommand')}</span>
                <code>{failureInstallCommand}</code>
              </div>
            )}
            <div className="dshMarketFailureOutput">
              <span>{t('failureOutput')}</span>
              <pre>{operationDetails ?? t('noFailureOutput')}</pre>
            </div>
            {desktopActionError !== undefined && <div className="dshMarketError" role="alert">{desktopActionError}</div>}
          </div>
        ) : preview !== undefined ? (
          <div className="dshMarketOperationReview">
            <OperationFacts operation={preview} t={t} />
            <div className="dshMarketOperationWarning"><StateDot state="warning" size={12} /><span>{t('operationWarning')}</span></div>
            <div className="dshMarketOperationWarning">
              <StateDot state="warning" size={12} />
              <span>
                {t('operationRiskBeforeContact')}
                <a href={DSH_DESKTOP_ISSUES_URL} target="_blank" rel="noopener noreferrer">{t('contactUs')}</a>
                {t('operationRiskAfterContact')}
              </span>
            </div>
            <div className="dshMarketOperationWarning"><StateDot state="warning" size={12} /><span>{t('restartAfterOperation')}</span></div>
            {pending && <div className="dshMarketOperationProgress" role="status"><StateDot state="ongoing" size={12} />{t('installing')}</div>}
            {operationError !== undefined && <div className="dshMarketError" role="alert">{operationError}</div>}
          </div>
        ) : (
          <div className="dshMarketDetails">
            <div className="dshMarketDetailsIntro">
              <PluginIcon item={value.item} large />
              <p>{value.item.description ?? value.item.summary}</p>
            </div>
            {inventoryLoading && (
              <div className="dshMarketOperationProgress" role="status">
                <StateDot state="ongoing" size={12} />{t('loadingInstallations')}
              </div>
            )}
            {inventoryError !== undefined && (
              <div className="dshMarketBanner" role="alert">
                <StateDot state="warning" />
                <span>{inventoryError}</span>
              </div>
            )}
            {installation !== undefined && (
              <div className="dshMarketReceipts">
                <InstallationCard
                  installation={installation}
                  operationPending={pending}
                  onUninstall={onUninstall}
                  t={t}
                />
              </div>
            )}
            {!inventoryLoading && inventoryError === undefined && installation === undefined && checking && (
              <div className="dshMarketOperationProgress" role="status">
                <StateDot state="ongoing" size={12} />{t('checkingInstallMethod')}
              </div>
            )}
            {installation === undefined && !inventoryLoading && !checking && operationError !== undefined && (
              <div className="dshMarketBanner" role="alert">
                <StateDot state="warning" />
                <span>{operationError}</span>
                <a href={verificationHelpHref} target="_blank" rel="noopener noreferrer">
                  {t('verificationDetails')} <IconRightUpOutline16 size={12} />
                </a>
              </div>
            )}
            {installation === undefined && !inventoryLoading && inventoryError === undefined && !checking && manualInstall !== undefined ? (
              <div className="dshMarketManualInstall">
                <div><h3>{t('manualInstallTitle')}</h3><p>{t('manualInstallBody')}</p></div>
                <div className="dshMarketCommand">
                  <span>{t('installCommand')}</span>
                  <code>{manualInstall.displayCommand}</code>
                </div>
                <div className="dshMarketOperationWarning"><StateDot state="warning" size={12} /><span>{t('manualNotVerified')}</span></div>
                {manualInstall.mutable && (
                  <div className="dshMarketOperationWarning"><StateDot state="warning" size={12} /><span>{t('mutableGithubWarning')}</span></div>
                )}
                <div className="dshMarketOperationWarning"><StateDot state="warning" size={12} /><span>{t('operationWarning')}</span></div>
                <div className="dshMarketOperationWarning">
                  <StateDot state="warning" size={12} />
                  <span>
                    {t('operationRiskBeforeContact')}
                    <a href={DSH_DESKTOP_ISSUES_URL} target="_blank" rel="noopener noreferrer">{t('contactUs')}</a>
                    {t('operationRiskAfterContact')}
                  </span>
                </div>
              </div>
            ) : installation === undefined
              && !inventoryLoading
              && inventoryError === undefined
              && !checking
              && operationError === undefined ? <div>{t('readOnly')}</div> : null}
            {desktopActionError !== undefined && <div className="dshMarketError" role="alert">{desktopActionError}</div>}
          </div>
        )}
      </>
    </Modal>
  )
}
