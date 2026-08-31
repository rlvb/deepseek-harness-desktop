import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { applyEnterpriseBrand, EnterpriseBrandName } from '../src/client/enterprise-brand.tsx'

describe('enterprise sidebar brand', () => {
  it('renders the supplied 8H artwork with the Token factory name', () => {
    const markup = renderToStaticMarkup(createElement(EnterpriseBrandName))

    expect(markup).toContain('Token\u5de5\u5382')
    expect(markup).toContain('dshEnterpriseBrandLogo')
    expect(markup).toContain('viewBox="1641 453 125 57"')
    expect(markup.match(/<path/g)).toHaveLength(3)
    expect(markup.toLowerCase()).not.toContain('deepseek')
  })

  it('shadows only sidebar.brand.name at a lower priority than the official occupant', () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const inject = vi.fn((_name: string, mount: () => unknown) => mount())
    const effect = vi.fn()

    applyEnterpriseBrand({
      effect,
      slots: { inject, register },
    } as never)

    expect(effect).toHaveBeenCalledOnce()
    expect(inject).toHaveBeenCalledWith('sidebar.brand.name', expect.any(Function))
    expect(register).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledWith({
      name: 'sidebar.brand.name',
      priority: -100,
    }, EnterpriseBrandName)
  })
})
