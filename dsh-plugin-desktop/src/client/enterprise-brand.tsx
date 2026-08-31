import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/remote'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

const ENTERPRISE_BRAND_STYLE_ID = 'dsh-plugin-desktop/enterprise-brand'

/** Stable enterprise wordmark styling; the host keeps ownership of the surrounding sidebar layout. */
const ENTERPRISE_BRAND_STYLES = `
.dshEnterpriseBrandName { display: inline-flex; align-items: center; gap: 7px; min-width: 0; height: 24px; color: inherit; white-space: nowrap; }
.dshEnterpriseBrandLogo { display: block; flex: 0 0 50px; width: 50px; height: 24px; overflow: visible; color: inherit; }
.dshEnterpriseBrandSuffix { overflow: hidden; font: inherit; font-size: 15px; font-weight: 600; line-height: 24px; letter-spacing: 0.01em; text-overflow: ellipsis; }
`

/** Render the 8H warehouse artwork beside the Token factory product name. */
export function EnterpriseBrandName(): JSX.Element {
  return (
    <span className='dshEnterpriseBrandName' aria-label={'8\u53f7\u4ed3 Token\u5de5\u5382'}>
      <svg
        className='dshEnterpriseBrandLogo'
        viewBox='1641 453 125 57'
        preserveAspectRatio='xMidYMid meet'
        aria-hidden='true'
        focusable='false'
      >
        <path transform='matrix(1,0,0,-1,1746.6471,461.46778)' d='M0 0V0L5.539-12.606H-8.85L-3.247 0ZM2.356-35.335H6.494 8.086C10.696-35.335 12.86-33.234 12.86-30.623V-28.968-24.83-16.299H17.381L7.64 5.985H-10.887L-20.755-16.299H-16.362V-35.78-39.282-41.574C-16.362-44.184-14.261-46.349-11.651-46.349H-10.123-5.857 14.834V-40.364H-5.921V-18.591H2.674V-29.35H-2.356V-35.335Z' fill='currentColor' fillRule='evenodd' />
        <path transform='matrix(1,0,0,-1,1689.9845,475.02857)' d='M0 0V0 19.482H25.403V0ZM27.567-23.493V-23.493C27.44-25.785 26.931-26.994 24.384-29.541 21.264-32.661 21.073-32.724 16.68-32.724H1.337V-26.74H17.635V-18.973H8.213C4.393-18.973 4.202-19.354 1.91-16.235 0-13.625 .127-13.434 2.992-10.632L5.284-8.277H-3.947V-2.356H29.541V-8.277H16.553L11.969-12.988H16.107 21.965 25.721C26.74-12.988 27.567-13.816 27.567-14.834V-20.946ZM15.471 13.497H9.805V5.9839999H15.471Z' fill='currentColor' fillRule='evenodd' />
        <path transform='matrix(1,0,0,-1,1662.7991,456.8203)' d='M0 0C.509-.064 1.337-.191 1.719-.446 2.292-.764 2.674-1.21 2.929-1.782 3.183-2.292 3.311-2.928 3.311-3.693V-18.972C3.311-19.736 3.183-20.373 2.865-20.946 2.547-21.455 2.101-21.901 1.528-22.219 1.146-22.41 .764-22.538 .318-22.601V-24.002C1.082-24.066 1.655-24.257 2.101-24.575 2.738-24.957 3.12-25.466 3.374-26.103 3.629-26.74 3.82-27.376 3.756-28.013V-45.585C3.82-46.285 3.629-46.922 3.374-47.558 3.12-48.131 2.738-48.641 2.101-49.086 1.655-49.341 .7-49.532 0-49.659-.828-49.723-2.483-49.723-3.311-49.659-4.011-49.532-4.966-49.341-5.411-49.086-5.985-48.641-6.43-48.131-6.685-47.558-6.94-46.922-7.067-46.285-7.067-45.585V-28.013C-7.067-27.376-6.94-26.74-6.685-26.103-6.43-25.466-5.985-24.957-5.411-24.575-4.902-24.257-4.329-24.066-3.629-24.002V-22.601C-4.075-22.538-4.457-22.41-4.839-22.219-5.411-21.901-5.794-21.455-6.112-20.946-6.494-20.373-6.621-19.736-6.621-18.972V-3.693C-6.621-2.928-6.494-2.292-6.239-1.782-5.985-1.21-5.539-.764-5.03-.446-4.648-.191-3.82-.064-3.247 0-2.61 .127-.764 .127 0 0M16.49-37.563C16.49-35.398 16.108-33.488 15.344-31.896 14.579-30.241 13.561-28.904 12.288-27.758 10.951-26.676 9.486-25.785 7.767-25.084 6.048-24.448 4.266-23.938 2.292-23.556V-23.429C3.82-23.111 5.348-22.665 6.812-22.028 8.277-21.392 9.614-20.564 10.823-19.545 11.969-18.527 12.924-17.317 13.625-15.98 14.325-14.579 14.707-13.052 14.707-11.333 14.707-9.741 14.389-8.277 13.816-6.939 13.306-5.603 12.479-4.457 11.524-3.438 10.505-2.355 9.359-1.528 8.086-.828 6.812-.127 5.412 .446 4.011 .828 2.801 1.146 1.21 1.273 0 1.337-1.082 1.401-2.165 1.401-3.247 1.337-4.52 1.337-6.112 1.146-7.322 .828-8.722 .446-10.123-.127-11.396-.828-12.669-1.528-13.815-2.355-14.834-3.438-15.789-4.457-16.553-5.603-17.126-6.939-17.699-8.277-18.017-9.741-18.017-11.333-18.017-13.052-17.635-14.579-16.935-15.98-16.235-17.317-15.28-18.527-14.07-19.545-12.924-20.564-11.587-21.392-10.123-22.028-8.659-22.665-7.131-23.111-5.603-23.429V-23.556C-7.576-23.938-9.359-24.448-11.078-25.084-12.733-25.785-14.261-26.676-15.534-27.758-16.871-28.904-17.89-30.241-18.654-31.896-19.354-33.488-19.736-35.398-19.736-37.563-19.736-39.282-19.418-40.874-18.781-42.274-18.081-43.675-17.19-44.948-16.107-46.03-14.961-47.113-13.688-48.004-12.224-48.768-10.76-49.468-9.232-50.041-7.64-50.423-6.367-50.742-4.648-50.933-3.311-50.996-2.228-51.06-1.082-51.06 0-50.996 1.337-50.933 3.056-50.742 4.393-50.423 5.985-50.041 7.513-49.468 8.913-48.768 10.378-48.004 11.651-47.113 12.797-46.03 13.943-44.948 14.834-43.675 15.471-42.274 16.108-40.874 16.49-39.282 16.49-37.563' fill='currentColor' fillRule='evenodd' />
      </svg>
      <span className='dshEnterpriseBrandSuffix'>{'Token\u5de5\u5382'}</span>
    </span>
  )
}

/** Install the enterprise wordmark stylesheet once for this plugin lifetime. */
export function installEnterpriseBrandStyles(): () => void {
  const existing = document.querySelector<HTMLStyleElement>(
    `style[data-plugin-css="${ENTERPRISE_BRAND_STYLE_ID}"]`,
  )
  if (existing) return () => {}

  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-plugin-desktop'
  style.dataset.pluginCss = ENTERPRISE_BRAND_STYLE_ID
  style.textContent = ENTERPRISE_BRAND_STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** Shadow only the official sidebar name cell; the upstream whale mark remains unchanged. */
export function applyEnterpriseBrand(ctx: ClientContext): void {
  ctx.effect(
    () => installEnterpriseBrandStyles(),
    'dsh-plugin-desktop: enterprise sidebar brand styles',
  )
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
    priority: -100,
  }, EnterpriseBrandName))
}
