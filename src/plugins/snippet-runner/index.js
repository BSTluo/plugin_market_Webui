// Snippet Runner plugin entry
// This module can call cross-origin APIs when those APIs support CORS.

window.pluginMarket = window.pluginMarket || {}
window.pluginMarket.snippetRunner = {
  name: 'Snippet Runner',
  loadedAt: new Date().toISOString(),
  message: 'Snippet Runner 已启用',
}

console.log('[plugin-market] Snippet Runner loaded')
