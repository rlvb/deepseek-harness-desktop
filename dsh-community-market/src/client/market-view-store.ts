import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

export interface MarketViewState {
  open: boolean
  initialView: 'discover' | 'internal'
}

type MarketViewActions = {
  open: (draft: MarketViewState) => void
  openInternal: (draft: MarketViewState) => void
  close: (draft: MarketViewState) => void
}

export function createMarketViewStore(): EngineStoreHandle<MarketViewState, MarketViewActions> {
  return defineStore({
    init: (): MarketViewState => ({ open: false, initialView: 'discover' }),
    actions: {
      open: draft => { draft.open = true; draft.initialView = 'discover' },
      openInternal: draft => { draft.open = true; draft.initialView = 'internal' },
      close: draft => { draft.open = false },
    },
  })
}
