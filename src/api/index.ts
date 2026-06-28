type BridgeRequest = {
  source: 'plugin-market'
  target: 'iirosejs'
  requestId: string
  action: 'extJs:get' | 'extJs:set'
  payload?: { value?: string }
}

type BridgeResponse = {
  source: 'iirosejs'
  target: 'plugin-market'
  requestId: string
  ok: boolean
  value?: string | null
  error?: string
}

function createRequestId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function isIframeBridgeAvailable() {
  return typeof window !== 'undefined' && window.parent !== window
}

function readLocalExtJs() {
  return localStorage.getItem('extJs')
}

function writeLocalExtJs(value: string) {
  localStorage.setItem('extJs', value)
}

function normalizePluginUrl(value: string) {
  return new URL(value, window.location.origin).href
}

function splitExtJsList(value: string | null) {
  return (value ?? '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function requestExtJs(action: BridgeRequest['action'], payload?: BridgeRequest['payload']) {
  if (!isIframeBridgeAvailable()) {
    if (action === 'extJs:get') {
      return Promise.resolve(readLocalExtJs())
    }

    const value = payload?.value ?? ''
    writeLocalExtJs(value)
    return Promise.resolve(value)
  }

  return new Promise<string | null>((resolve, reject) => {
    const requestId = createRequestId()

    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new Error('extJs bridge timeout'))
    }, 3000)

    const onMessage = (event: MessageEvent<BridgeResponse>) => {
      const data = event.data
      if (!data || data.source !== 'iirosejs' || data.target !== 'plugin-market' || data.requestId !== requestId) {
        return
      }

      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)

      if (!data.ok) {
        reject(new Error(data.error ?? 'extJs bridge error'))
        return
      }

      resolve(data.value ?? null)
    }

    window.addEventListener('message', onMessage)

    const request: BridgeRequest = {
      source: 'plugin-market',
      target: 'iirosejs',
      requestId,
      action,
      payload,
    }

    window.parent.postMessage(request, '*')
  })
}

export const GetEnableJsPlugin = async () => {
  return requestExtJs('extJs:get')
}

function normalizeExtJsList(value: string | null) {
  return splitExtJsList(value).map((item) => normalizePluginUrl(item))
}

export const InStallPlugin = async (url: string) => {
  const current = (await requestExtJs('extJs:get')) ?? ''
  const normalizedUrl = normalizePluginUrl(url)
  const items = normalizeExtJsList(current)
  const nextItems = items.includes(normalizedUrl) ? items : [...items, normalizedUrl]
  const next = nextItems.join(' ')
  await requestExtJs('extJs:set', { value: next })
  return next
}

export const UnInstallPlugin = async (url: string) => {
  const current = (await requestExtJs('extJs:get')) ?? ''
  const normalizedUrl = normalizePluginUrl(url)
  const next = normalizeExtJsList(current)
    .filter((item) => item !== normalizedUrl)
    .join(' ')

  await requestExtJs('extJs:set', { value: next })
  return next
}