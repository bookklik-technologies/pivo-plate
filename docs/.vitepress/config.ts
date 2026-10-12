import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'en-US',
  title: 'PiVo Plate',
  description:
    'A local-first browser tile-to-3D modeling editor. Draw tiles on construction planes, organize the scene, export GLB/OBJ.',
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' }]],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
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
