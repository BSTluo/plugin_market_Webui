import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

function serveEndpointScript() {
  const endpointFile = resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/EndPoint/index.js')

  return {
    name: 'serve-endpoint-script',
    configureServer(server: any) {
      server.middlewares.use('/EndPoint/index.js', async (_req: any, res: any, next: any) => {
        try {
          const source = await readFile(endpointFile, 'utf-8')
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
          res.end(source)
        } catch (error) {
          next(error)
        }
      })
    },
    configurePreviewServer(server: any) {
      server.middlewares.use('/EndPoint/index.js', async (_req: any, res: any, next: any) => {
        try {
          const source = await readFile(endpointFile, 'utf-8')
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
          res.end(source)
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), serveEndpointScript()],
  server: {
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Content-Security-Policy': "frame-ancestors *",
    },
    allowedHosts: [
      'iirosemarket.reifuu.icu'
    ]
  },
  preview: {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Content-Security-Policy': "frame-ancestors *",
    },
  },
})
