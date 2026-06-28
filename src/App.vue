<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { GetEnableJsPlugin, InStallPlugin, UnInstallPlugin } from './api'

type PluginRecord = {
  id: string
  name: string
  folder: string
  readme: string
  cover: string | null
  imageCount: number
  summary: string
  categories: string[]
  author: PluginAuthor | null
  entryUrl: string | null
  hasEntry: boolean
}

type PluginAuthor = {
  avatar: string | null
  nickname: string
  id: string
}

const readmeModules = {
  ...import.meta.glob('./plugins/*/README.md', {
    eager: true,
    import: 'default',
    query: '?raw',
  }),
  ...import.meta.glob('./plugins/*/Readme.md', {
    eager: true,
    import: 'default',
    query: '?raw',
  }),
} as Record<string, string>

const imageModules = import.meta.glob('./plugins/*/imgs/*', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

const entryModules = import.meta.glob('./plugins/*/index.js', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

const pluginFiles = Object.entries(readmeModules)
  .map(([path, readme]) => {
    const match = path.match(/\.\/plugins\/([^/]+)\/README\.md$/i)
    if (!match) return null

    const folder = match[1]
    const folderPrefix = `./plugins/${folder}/imgs/`
    const entryUrl = entryModules[`./plugins/${folder}/index.js`] ?? null
    const relatedImages = Object.fromEntries(
      Object.entries(imageModules)
        .filter(([imagePath]) => imagePath.startsWith(folderPrefix))
        .map(([imagePath, imageUrl]) => [imagePath.replace(folderPrefix, './imgs/'), imageUrl]),
    )

    return createPluginRecord(folder, readme, relatedImages, entryUrl)
  })
  .filter((item): item is PluginRecord => Boolean(item))
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

const categories = ['全部', ...new Set(pluginFiles.flatMap((plugin) => plugin.categories))]
const activeCategory = ref('全部')
const searchText = ref('')
const selectedPluginId = ref<string | null>(null)
const installedPluginUrls = ref<string[]>([])
const installedPluginUrlsReady = ref(false)

const filteredPlugins = computed(() => {
  const keyword = searchText.value.trim().toLowerCase()

  return pluginFiles.filter((plugin) => {
    const matchesCategory = activeCategory.value === '全部' || plugin.categories.includes(activeCategory.value)
    const matchesKeyword =
      !keyword ||
      [plugin.name, plugin.summary, plugin.readme, plugin.folder, ...plugin.categories]
        .join(' ')
        .toLowerCase()
        .includes(keyword)

    return matchesCategory && matchesKeyword
  })
})

const selectedPlugin = computed(() => pluginFiles.find((plugin) => plugin.id === selectedPluginId.value) ?? null)

onMounted(async () => {
  const value = await GetEnableJsPlugin()
  installedPluginUrls.value = parseInstalledUrls(value)
  installedPluginUrlsReady.value = true
})

function createPluginRecord(
  folder: string,
  readme: string,
  imageMap: Record<string, string>,
  entryUrl: string | null,
): PluginRecord {
  const name = extractTitle(readme) ?? folder
  const summary = extractSummary(readme)
  const categories = extractCategories(readme)
  const author = extractAuthor(readme, imageMap)

  return {
    id: folder,
    name,
    folder,
    readme: renderMarkdown(readme, imageMap),
    cover: findCoverImage(readme, imageMap),
    imageCount: Object.keys(imageMap).length,
    summary,
    categories,
    author,
    entryUrl,
    hasEntry: Boolean(entryUrl),
  }
}

async function loadPlugin(plugin: PluginRecord) {
  if (!plugin.entryUrl) return

  const absoluteUrl = toAbsolutePluginUrl(plugin.entryUrl)
  await InStallPlugin(absoluteUrl)
  installedPluginUrls.value = parseInstalledUrls(await GetEnableJsPlugin())
}

async function uninstallPlugin(plugin: PluginRecord) {
  if (!plugin.entryUrl) return

  await UnInstallPlugin(toAbsolutePluginUrl(plugin.entryUrl))
  installedPluginUrls.value = parseInstalledUrls(await GetEnableJsPlugin())
}

function parseInstalledUrls(value: string | null) {
  return (value ?? '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => toAbsolutePluginUrl(item))
}

function isInstalled(plugin: PluginRecord) {
  return Boolean(plugin.entryUrl && installedPluginUrls.value.includes(toAbsolutePluginUrl(plugin.entryUrl)))
}

function toAbsolutePluginUrl(url: string) {
  return new URL(url, window.location.origin).href
}

function openPluginDetail(plugin: PluginRecord) {
  selectedPluginId.value = plugin.id
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function closePluginDetail() {
  selectedPluginId.value = null
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function extractTitle(readme: string) {
  const line = readme.split(/\r?\n/).find((item) => /^#\s+/.test(item))
  return line?.replace(/^#\s+/, '').trim()
}

function extractSummary(readme: string) {
  const lines = readme.split(/\r?\n/)
  const titleIndex = lines.findIndex((item) => /^#\s+/.test(item))
  const startIndex = titleIndex >= 0 ? titleIndex + 1 : 0

  for (let index = startIndex; index < lines.length; index += 1) {
    const value = lines[index].trim()
    if (value) {
      return value.replace(/^>\s*/, '').slice(0, 120)
    }
  }

  return '暂无简介'
}

function extractCategories(readme: string) {
  const match = readme.match(/^标签[:：]\s*(.+)$/im)
  if (!match) return ['通用']

  return match[1]
    .split(/[,，、|]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function extractAuthor(readme: string, imageMap: Record<string, string>): PluginAuthor | null {
  const avatarMatch = readme.match(/^作者头像[:：]\s*(.+)$/im)
  const nicknameMatch = readme.match(/^作者昵称[:：]\s*(.+)$/im)
  const idMatch = readme.match(/^作者ID[:：]\s*(.+)$/im)

  if (!avatarMatch && !nicknameMatch && !idMatch) return null

  const avatarValue = avatarMatch?.[1]?.trim() ?? ''
  const avatar = resolveMarkdownImage(avatarValue, imageMap)

  return {
    avatar,
    nickname: nicknameMatch?.[1]?.trim() || '匿名作者',
    id: idMatch?.[1]?.trim() || 'unknown',
  }
}

function resolveMarkdownImage(value: string, imageMap: Record<string, string>) {
  const markdownMatch = value.match(/^!\[[^\]]*\]\(([^)]+)\)$/)
  if (markdownMatch) {
    const src = markdownMatch[1]
    return imageMap[src] ?? imageMap[`./imgs/${src.replace(/^\.\//, '')}`] ?? src
  }

  return (imageMap[value] ?? imageMap[`./imgs/${value.replace(/^\.\//, '')}`] ?? value) || null
}

function findCoverImage(readme: string, imageMap: Record<string, string>) {
  const markdownImage = readme.match(/!\[[^\]]*\]\(([^)]+)\)/)
  if (!markdownImage) return Object.values(imageMap)[0] ?? null

  const imageUrl = imageMap[markdownImage[1]]
  return imageUrl ?? Object.values(imageMap)[0] ?? null
}

function renderMarkdown(readme: string, imageMap: Record<string, string>) {
  const normalized = readme.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, src: string) => {
    const resolved = imageMap[src] ?? imageMap[`./imgs/${src.replace(/^\.\//, '')}`] ?? src
    return `<img src="${resolved}" alt="${escapeHtml(alt)}" />`
  })

  const lines = normalized.split(/\r?\n/)
  const html: string[] = []
  let inList = false
  let inCode = false
  let codeBuffer: string[] = []

  const flushList = () => {
    if (inList) {
      html.push('</ul>')
      inList = false
    }
  }

  const flushCode = () => {
    if (inCode) {
      html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`)
      codeBuffer = []
      inCode = false
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    if (/^```/.test(line)) {
      if (inCode) {
        flushCode()
      } else {
        flushList()
        inCode = true
      }
      continue
    }

    if (inCode) {
      codeBuffer.push(rawLine)
      continue
    }

    if (!line.trim()) {
      flushList()
      continue
    }

    if (/^#\s+/.test(line)) {
      flushList()
      html.push(`<h1>${inlineFormat(line.replace(/^#\s+/, ''))}</h1>`)
      continue
    }

    if (/^##\s+/.test(line)) {
      flushList()
      html.push(`<h2>${inlineFormat(line.replace(/^##\s+/, ''))}</h2>`)
      continue
    }

    if (/^[-*+]\s+/.test(line)) {
      if (!inList) {
        html.push('<ul>')
        inList = true
      }
      html.push(`<li>${inlineFormat(line.replace(/^[-*+]\s+/, ''))}</li>`)
      continue
    }

    flushList()
    html.push(`<p>${inlineFormat(line)}</p>`)
  }

  flushList()
  flushCode()

  return html.join('')
}

function inlineFormat(text: string) {
  const imageTokens: string[] = []
  const preserved = text.replace(/<img\b[^>]*>/g, (match) => {
    const token = `__IMG_TOKEN_${imageTokens.length}__`
    imageTokens.push(match)
    return token
  })

  const formatted = escapeHtml(preserved)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')

  return imageTokens.reduce((output, image, index) => output.replace(`__IMG_TOKEN_${index}__`, image), formatted)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
</script>

<template>
  <main class="market-page">
    <template v-if="selectedPlugin">
      <section class="detail-page">
        <div class="detail-page__topbar">
          <button type="button" class="back-button" @click="closePluginDetail">← 返回市场</button>
          <span class="detail-page__meta">插件介绍</span>
        </div>

        <article class="detail-card">
          <header class="detail-card__header">
            <div>
              <span class="eyebrow">{{ selectedPlugin.hasEntry ? 'JS 插件' : '内容包' }}</span>
              <h1>{{ selectedPlugin.name }}</h1>
              <p class="hero__description">{{ selectedPlugin.summary }}</p>
            </div>

            <div class="badge-group">
              <span class="badge">{{ selectedPlugin.imageCount }} 图</span>
              <span v-for="tag in selectedPlugin.categories" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </header>

          <div class="detail-card__actions" v-if="installedPluginUrlsReady && selectedPlugin.entryUrl">
            <button
              v-if="!isInstalled(selectedPlugin)"
              type="button"
              class="load-button load-button--inline"
              @click="loadPlugin(selectedPlugin)"
            >
              安装插件
            </button>

            <button
              v-else
              type="button"
              class="load-button load-button--inline load-button--ghost"
              @click="uninstallPlugin(selectedPlugin)"
            >
              删除插件
            </button>
          </div>

          <section v-if="selectedPlugin.author" class="author-card">
            <img
              v-if="selectedPlugin.author.avatar"
              class="author-card__avatar"
              :src="selectedPlugin.author.avatar"
              :alt="selectedPlugin.author.nickname"
            />
            <div v-else class="author-card__avatar author-card__avatar--placeholder">
              {{ selectedPlugin.author.nickname.slice(0, 1) }}
            </div>

            <div class="author-card__body">
              <div class="author-card__label">作者信息</div>
              <div class="author-card__name">{{ selectedPlugin.author.nickname }}</div>
              <div class="author-card__id">ID: {{ selectedPlugin.author.id }}</div>
            </div>
          </section>

          <div class="detail-card__content markdown" v-html="selectedPlugin.readme"></div>
        </article>
      </section>
    </template>

    <template v-else>
    <section class="hero">
      <div class="hero__copy">
        <span class="eyebrow">IIROSE JS 插件市场</span>
        <h1>发现、浏览、安装你需要的网页插件</h1>
        <p class="hero__description">实时查看插件数量、分类和内容简介，快速找到适合当前场景的工具。</p>

        <div class="stats">
          <div>
            <strong>{{ pluginFiles.length }}</strong>
            <span>个插件</span>
          </div>
          <div>
            <strong>{{ categories.length - 1 }}</strong>
            <span>个分类</span>
          </div>
        </div>
      </div>

      <aside class="hero__panel">
        <div class="panel-card">
          <span class="panel-card__label">当前插件数</span>
          <div class="panel-card__count">{{ pluginFiles.length }}</div>
          <p class="panel-card__note">持续更新中</p>
        </div>
      </aside>
    </section>

    <section class="toolbar">
      <div class="search-box">
        <label for="search">搜索插件</label>
        <input id="search" v-model="searchText" type="search" placeholder="输入名称、标签或简介" />
      </div>

      <div class="filters" role="tablist" aria-label="插件分类">
        <button
          v-for="category in categories"
          :key="category"
          type="button"
          class="chip"
          :class="{ 'chip--active': activeCategory === category }"
          @click="activeCategory = category"
        >
          {{ category }}
        </button>
      </div>
    </section>

    <section class="section-block">
      <div class="section-block__header">
        <h2>全部插件</h2>
        <span>{{ filteredPlugins.length }} 项</span>
      </div>

      <div v-if="filteredPlugins.length" class="plugin-grid">
        <article v-for="plugin in filteredPlugins" :key="plugin.id" class="plugin-card">
          <div class="plugin-card__cover">
            <img v-if="plugin.cover" :src="plugin.cover" :alt="plugin.name + ' 预览图'" />
            <div v-else class="plugin-card__placeholder">
              <span>{{ plugin.name.slice(0, 2) }}</span>
            </div>
          </div>

          <div class="plugin-card__body">
            <div class="plugin-card__title-row">
              <h3>{{ plugin.name }}</h3>
              <div class="badge-group">
                <span class="badge">{{ plugin.imageCount }} 图</span>
                <span class="badge badge--soft">{{ plugin.hasEntry ? 'JS 插件' : '内容包' }}</span>
              </div>
            </div>

            <p class="plugin-card__summary">{{ plugin.summary }}</p>

            <div class="tag-list">
              <span v-for="tag in plugin.categories" :key="tag" class="tag">{{ tag }}</span>
            </div>

            <button type="button" class="load-button load-button--ghost" @click="openPluginDetail(plugin)">
              查看插件介绍
            </button>

            <button
              v-if="installedPluginUrlsReady && plugin.entryUrl && !isInstalled(plugin)"
              type="button"
              class="load-button"
              @click="loadPlugin(plugin)"
            >
              安装插件
            </button>

            <button
              v-else-if="installedPluginUrlsReady && plugin.entryUrl && isInstalled(plugin)"
              type="button"
              class="load-button load-button--ghost"
              @click="uninstallPlugin(plugin)"
            >
              删除插件
            </button>
          </div>
        </article>
      </div>

      <div v-else class="empty-state">没有找到匹配的插件</div>
    </section>
    </template>
  </main>
</template>
