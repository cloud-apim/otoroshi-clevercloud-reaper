// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'overview',
    'quickstart',
    'install',
    {
      type: 'category',
      label: 'Using the reaper',
      collapsed: false,
      items: ['route', 'waking-up', 'staying-awake', 'waiting-page', 'console', 'savings'],
    },
    {
      type: 'category',
      label: 'How it works',
      collapsed: false,
      items: ['lifecycle', 'architecture'],
    },
    {
      type: 'category',
      label: 'Operations',
      collapsed: false,
      items: ['operations', 'troubleshooting'],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: ['reference/configuration', 'reference/plugin', 'reference/admin-api', 'reference/events', 'reference/headers'],
    },
    'faq',
  ],
};

export default sidebars;
