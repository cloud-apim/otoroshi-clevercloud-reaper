// @ts-check
import { themes as prismThemes } from 'prism-react-renderer';

const repo = 'https://github.com/cloud-apim/otoroshi-clevercloud-reaper';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Clever Cloud Reaper',
  tagline: 'Put the Clever Cloud apps nobody uses to sleep, wake them up on the next request',
  favicon: 'img/favicon.svg',

  url: 'https://cloud-apim.github.io',
  baseUrl: '/otoroshi-clevercloud-reaper/',

  organizationName: 'cloud-apim',
  projectName: 'otoroshi-clevercloud-reaper',

  onBrokenLinks: 'throw',

  markdown: {
    format: 'detect',
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
      onBrokenMarkdownImages: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl: `${repo}/edit/main/documentation/`,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themes: [
    '@docusaurus/theme-mermaid',
    [
      // offline index: no Algolia account, no third-party request from the docs
      /** @type {import("@easyops-cn/docusaurus-search-local").PluginOptions} */
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['en'],
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
        indexBlog: false,
      },
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/logo.svg',
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
      mermaid: {
        theme: { light: 'neutral', dark: 'dark' },
      },
      navbar: {
        title: 'Clever Cloud Reaper',
        logo: {
          alt: 'Clever Cloud Reaper',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docsSidebar',
            position: 'left',
            label: 'Documentation',
          },
          { href: `${repo}/releases/latest`, label: 'Download', position: 'right' },
          { href: repo, label: 'GitHub', position: 'right' },
          { href: 'https://www.cloud-apim.com', label: 'Cloud APIM', position: 'right' },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              { label: 'Overview', to: '/docs/overview' },
              { label: 'Quickstart', to: '/docs/quickstart' },
              { label: 'Install', to: '/docs/install' },
              { label: 'Configuring a route', to: '/docs/route' },
              { label: 'Troubleshooting', to: '/docs/troubleshooting' },
            ],
          },
          {
            title: 'Community',
            items: [
              { label: 'Discord', href: 'https://discord.cloud-apim.com' },
              { label: 'Twitter', href: 'https://twitter.com/cloudapim' },
              { label: 'Youtube', href: 'https://www.youtube.com/@CloudAPIM' },
            ],
          },
          {
            title: 'More',
            items: [
              { label: 'Cloud APIM', href: 'https://www.cloud-apim.com' },
              { label: 'GitHub', href: repo },
              { label: 'Otoroshi', href: 'https://maif.github.io/otoroshi/manual/docs/getting-started' },
              { label: 'Clever Cloud', href: 'https://www.clever.cloud' },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Cloud APIM. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        // only what the docs use: prism resolves no dependencies here, so a language that needs
        // another one (scala needs java needs clike) breaks the build
        additionalLanguages: ['bash', 'json', 'json5', 'http'],
      },
    }),
};

export default config;
