import { defineConfig } from 'vitepress'

const base = process.env.DOCS_BASE || '/'
const appUrl = 'https://bookklik-technologies.github.io/pivo-plate/'
const docsUrl = appUrl + 'docs/'
const socialImage = docsUrl + 'screenshots/app.png'

export default defineConfig({
  base,
  lang: 'en-US',
  title: 'PiVo Plate',
  titleTemplate: ':title | PiVo Plate Documentation',
  description:
    'A local-first browser tile-to-3D modeling editor. Draw tiles on construction planes, organize the scene, export GLB/OBJ.',
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}icon.svg` }]],
  sitemap: {
    hostname: docsUrl,
    transformItems: (items) => items.filter((item) => item.url !== '404.html'),
  },
  transformHead({ page }) {
    if (page === '404.md') return [['meta', { name: 'robots', content: 'noindex, follow' }]]
  },
  transformPageData(pageData) {
    pageData.frontmatter.head ??= []
    if (pageData.relativePath === '404.md') return
    const canonical = docsUrl + pageData.relativePath.replace(/index\.md$/, '').replace(/\.md$/, '.html')
    const title = pageData.frontmatter.layout === 'home' || pageData.title === 'PiVo Plate' || !pageData.title
      ? 'PiVo Plate Documentation'
      : pageData.title + ' | PiVo Plate Documentation'
    const description = pageData.description
    pageData.frontmatter.head.push(
      ['link', { rel: 'canonical', href: canonical }],
      ['meta', { name: 'robots', content: 'index, follow, max-image-preview:large' }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:site_name', content: 'PiVo Plate' }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: canonical }],
      ['meta', { property: 'og:locale', content: 'en_US' }],
      ['meta', { property: 'og:image', content: socialImage }],
      ['meta', { property: 'og:image:type', content: 'image/png' }],
      ['meta', { property: 'og:image:width', content: '1440' }],
      ['meta', { property: 'og:image:height', content: '1000' }],
      ['meta', { property: 'og:image:alt', content: 'PiVo Plate editor showing a tiled 3D room and texture atlas' }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
      ['meta', { name: 'twitter:image', content: socialImage }],
      ['meta', { name: 'twitter:image:alt', content: 'PiVo Plate editor showing a tiled 3D room and texture atlas' }],
    )
  },
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Open app', link: appUrl, target: '_blank', rel: 'noopener' },
      { text: 'Tutorials', link: '/tutorials/' },
      { text: 'Guide', link: '/guide' },
      { text: 'Formats', link: '/formats' },
      { text: 'API', link: '/api' },
      {
        text: 'Verification',
        items: [
          { text: 'Overview', link: '/verification' },
          { text: 'Module contracts', link: '/CONTRACTS' },
          { text: 'PNG validation', link: '/PNG_VALIDATION' },
          { text: 'Validation record', link: '/VALIDATION' },
        ],
      },
      { text: 'Limitations', link: '/limitations' },
    ],
    sidebar: [
      {
        text: 'Getting started',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Installation & running', link: '/getting-started' },
          { text: 'User guide', link: '/guide' },
        ],
      },
      {
        text: 'Tutorials',
        items: [
          { text: 'Overview', link: '/tutorials/' },
          { text: '1. Draw a tiled platform', link: '/tutorials/first-platform' },
          { text: '2. Add and organize a wall', link: '/tutorials/add-wall' },
          { text: '3. Re-texture a face and export GLB', link: '/tutorials/edit-export' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'File formats', link: '/formats' },
          { text: 'Core & IO API', link: '/api' },
        ],
      },
      {
        text: 'Project',
        items: [
          { text: 'Verification', link: '/verification' },
          { text: 'Limitations', link: '/limitations' },
          { text: 'Module contracts', link: '/CONTRACTS' },
          { text: 'Validation record', link: '/VALIDATION' },
          { text: 'PNG validation', link: '/PNG_VALIDATION' },
          { text: 'Themes', link: '/THEMES' },
          { text: 'Typography', link: '/TYPOGRAPHY' },
        ],
      },
    ],
    search: {
      provider: 'local',
    },
    footer: {
      message: 'PiVo Plate is released under the MIT License.',
      copyright: 'Copyright © 2026 Bookklik Technologies',
    },
  },
})
