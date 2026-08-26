/** Desktop-owned authenticated browser window for trusted Host integrations. */

import { BrowserWindow, shell } from 'electron'

export interface DesktopEmbeddedBrowserLoginOptions {
  readonly url: string
  readonly allowedOrigins: readonly string[]
  readonly storageKeys: readonly string[]
  readonly title?: string
  readonly width?: number
  readonly height?: number
  readonly timeoutMs?: number
}

export interface DesktopEmbeddedBrowserLoginResult {
  readonly storage: Readonly<Record<string, string>>
  readonly userAgent: string
  readonly finalUrl: string
}

export interface DesktopEmbeddedBrowser {
  login(options: DesktopEmbeddedBrowserLoginOptions): Promise<DesktopEmbeddedBrowserLoginResult>
  dispose(): void
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_WIDTH = 520
const DEFAULT_HEIGHT = 860
const STORAGE_POLL_MS = 750
const MAX_ORIGINS = 16
const MAX_STORAGE_KEYS = 16

function normalizeOrigins(values: readonly string[]): ReadonlySet<string> {
  if (values.length === 0 || values.length > MAX_ORIGINS) {
    throw new Error('desktop embedded browser requires a bounded origin allowlist')
  }
  const origins = new Set<string>()
  for (const value of values) {
    const url = new URL(value)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.origin !== value
      || url.username !== ''
      || url.password !== '') {
      throw new Error(`desktop embedded browser origin is invalid: ${value}`)
    }
    origins.add(url.origin)
  }
  return origins
}

function assertLoginUrl(value: string, origins: ReadonlySet<string>): URL {
  const url = new URL(value)
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !origins.has(url.origin)) {
    throw new Error('desktop embedded browser login URL is outside the allowlist')
  }
  return url
}

function readStorageExpression(keys: readonly string[]): string {
  const encoded = JSON.stringify(keys)
  return `JSON.stringify(Object.fromEntries(${encoded}.map((key) => [key, localStorage.getItem(key) || ''])))`
}

function parseStorage(value: unknown, keys: readonly string[]): Readonly<Record<string, string>> {
  if (typeof value !== 'string') return {}
  let parsed: unknown
  try { parsed = JSON.parse(value) as unknown } catch { return {} }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const result: Record<string, string> = {}
  for (const key of keys) {
    const item = (parsed as Record<string, unknown>)[key]
    if (typeof item === 'string' && item.length > 0) result[key] = item
  }
  return result
}

function hasAuthValue(storage: Readonly<Record<string, string>>): boolean {
  return Object.values(storage).some(value => value.length > 0)
}

/** Owns one short-lived login window at a time. */
export class DesktopEmbeddedBrowserService implements DesktopEmbeddedBrowser {
  private window: BrowserWindow | undefined
  private disposed = false
  private loginTask: Promise<DesktopEmbeddedBrowserLoginResult> | undefined

  login(options: DesktopEmbeddedBrowserLoginOptions): Promise<DesktopEmbeddedBrowserLoginResult> {
    if (this.disposed) return Promise.reject(new Error('desktop embedded browser is disposed'))
    if (this.loginTask !== undefined) return Promise.reject(new Error('a desktop embedded login is already active'))
    if (options.storageKeys.length === 0
      || options.storageKeys.length > MAX_STORAGE_KEYS
      || options.storageKeys.some(key => !/^[A-Za-z0-9_.-]{1,80}$/u.test(key))) {
      return Promise.reject(new Error('desktop embedded browser storage keys are invalid'))
    }
    const origins = normalizeOrigins(options.allowedOrigins)
    assertLoginUrl(options.url, origins)
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_TIMEOUT_MS) {
      return Promise.reject(new Error('desktop embedded browser timeout is invalid'))
    }
    const task = this.runLogin({ ...options, allowedOrigins: [...origins], timeoutMs }).finally(() => {
      if (this.loginTask === task) this.loginTask = undefined
    })
    this.loginTask = task
    return task
  }

  dispose(): void {
    this.disposed = true
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
  }

  private async runLogin(options: DesktopEmbeddedBrowserLoginOptions): Promise<DesktopEmbeddedBrowserLoginResult> {
    const origins = new Set(options.allowedOrigins)
    const loginUrl = assertLoginUrl(options.url, origins)
    const window = new BrowserWindow({
      title: options.title ?? 'DSH Sub2API 登录',
      width: options.width ?? DEFAULT_WIDTH,
      height: options.height ?? DEFAULT_HEIGHT,
      minWidth: 420,
      minHeight: 600,
      show: true,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        partition: 'persist:dsh-sub2api',
      },
    })
    this.window = window
    const chromeLikeUserAgent = window.webContents.getUserAgent().replace(/\sElectron\/\S+/u, '')
    window.webContents.setUserAgent(chromeLikeUserAgent)
    window.removeMenu()
    const isAllowed = (value: string): boolean => {
      try {
        const target = new URL(value)
        return (target.protocol === 'https:' || target.protocol === 'http:') && origins.has(target.origin)
      } catch {
        return false
      }
    }
    const navigate = (event: Electron.Event, value: string): void => {
      if (isAllowed(value)) return
      event.preventDefault()
      try {
        const target = new URL(value)
        if (target.protocol === 'https:' || target.protocol === 'http:' || target.protocol === 'mailto:') {
          void shell.openExternal(target.href).catch(() => {})
        }
      } catch {
        // Reject malformed or unsupported navigation.
      }
    }
    window.webContents.on('will-navigate', navigate)
    window.webContents.on('will-redirect', navigate)
    window.webContents.setWindowOpenHandler(({ url }) => ({ action: isAllowed(url) ? 'allow' : 'deny' }))
    const cleanup = (): void => {
      window.webContents.off('will-navigate', navigate)
      window.webContents.off('will-redirect', navigate)
      if (this.window === window) this.window = undefined
      if (!window.isDestroyed()) window.destroy()
    }
    try {
      await window.webContents.session.clearStorageData({ origin: loginUrl.origin, storages: ['localstorage'] })
      await window.loadURL(loginUrl.href)
      const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      let finalUrl = loginUrl.href
      while (!this.disposed && !window.isDestroyed() && Date.now() < deadline) {
        finalUrl = window.webContents.getURL() || finalUrl
        try {
          const raw = await window.webContents.executeJavaScript(
            readStorageExpression(options.storageKeys),
            true,
          )
          const storage = parseStorage(raw, options.storageKeys)
          if (hasAuthValue(storage)) {
            return Object.freeze({
              storage,
              userAgent: chromeLikeUserAgent,
              finalUrl,
            })
          }
        } catch {
          // The page may be between redirects or still loading.
        }
        await new Promise(resolve => setTimeout(resolve, STORAGE_POLL_MS))
      }
      if (this.disposed) throw new Error('desktop embedded browser was disposed')
      if (window.isDestroyed()) throw new Error('desktop embedded login was cancelled')
      throw new Error('desktop embedded login timed out')
    } finally {
      cleanup()
    }
  }
}

export default DesktopEmbeddedBrowserService
