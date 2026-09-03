/** Stable, UI-safe links for the first-party 1024Store deployment. */
export const DSH_1024STORE_HOSTNAME = 'tokenapi.chinabeego.com'
export const DSH_1024STORE_ORIGIN = 'https://tokenapi.chinabeego.com:9443'
export const DSH_1024STORE_ENDPOINT = `${DSH_1024STORE_ORIGIN}/dsh-market/api/v2/plugins`
export const DSH_1024STORE_PROJECT_BASE = `${DSH_1024STORE_ORIGIN}/dsh-market/plugins`
export const DSH_1024STORE_ADAPTER_ID = 'market.dsh-1024store-v2'
export const DSH_1024STORE_LEGACY_ADAPTER_ID = 'market.dsh-1024store-v1'

export function isDsh1024StoreAdapterId(value: string | undefined): boolean {
  return value === DSH_1024STORE_ADAPTER_ID || value === DSH_1024STORE_LEGACY_ADAPTER_ID
}

/** Canonical public 1024Store project page; it renders the reviewed README. */
export function dsh1024StoreProjectUrl(pluginId: string): string | undefined {
  const parts = pluginId.split('/').filter(Boolean)
  if (parts.length < 2 || parts.length > 201) return undefined
  return `${DSH_1024STORE_PROJECT_BASE}/${parts.map(encodeURIComponent).join('/')}`
}
