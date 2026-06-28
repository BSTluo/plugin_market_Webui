// UI Kit plugin entry
// Browser requests are allowed as long as remote services provide CORS headers.

window.pluginMarket = window.pluginMarket || {}
window.pluginMarket.uiKit = {
  name: 'UI Kit',
  loadedAt: new Date().toISOString(),
  message: 'UI Kit 已启用',
}

console.log('[plugin-market] UI Kit loaded')
