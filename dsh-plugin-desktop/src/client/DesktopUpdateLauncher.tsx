/** Sidebar entry for the Desktop's existing interactive update flow. */

import { useState } from 'react'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopSettingsApi } from './desktop-settings-api.ts'

/** Native updater capability passed to the sidebar registration. */
export interface DesktopUpdateLauncherInjected {
  readonly api: Pick<DesktopSettingsApi, 'checkForUpdates'>
}

/** Props supplied by the sidebar footer slot and Desktop settings namespace. */
export type DesktopUpdateLauncherProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'desktop.settings'>
  & InjectFace<DesktopUpdateLauncherInjected>

type UpdateActionState = 'idle' | 'busy' | 'failed'

/** Start the same confirmation, download, verification, and install flow as the tray. */
export function DesktopUpdateLauncher({ wide, api, t }: DesktopUpdateLauncherProps) {
  const [state, setState] = useState<UpdateActionState>('idle')
  const label = state === 'busy'
    ? t('updateActionBusy')
    : state === 'failed' ? t('updateActionFailed') : t('updateAction')

  const checkForUpdates = async (): Promise<void> => {
    if (state === 'busy') return
    setState('busy')
    try {
      await api.checkForUpdates()
      setState('idle')
    } catch {
      setState('failed')
    }
  }

  return (
    <button
      type="button"
      className="dshDesktopUpdateLauncher"
      data-wide={wide}
      data-state={state}
      aria-label={label}
      aria-busy={state === 'busy'}
      disabled={state === 'busy'}
      title={label}
      onClick={() => { void checkForUpdates() }}
    >
      <svg
        width={wide ? 16 : 18}
        height={wide ? 16 : 18}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
        <path d="M4 17v4h16v-4" />
      </svg>
      {wide ? <span>{label}</span> : null}
    </button>
  )
}
