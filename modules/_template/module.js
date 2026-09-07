// Module manifest. Copy this folder to start a module, then register it in
// app/modules.js. Manifests stay tiny — every feature is a lazy import().

import * as patients from '../../data/repositories/patients.js';

export default {
  id: 'template',
  name: 'Template',
  group: 'Platform',
  icon: 'widgets',

  // Sidebar entries, in order. `count` is optional and re-reads on every commit.
  nav: [
    {
      screen: 'example',
      label: 'Example screen',
      icon: 'list_alt',
      count: () => patients.counts().total,
    },
  ],

  // screen -> lazy import of its feature folder.
  routes: {
    example: () => import('./features/example/example.js'),
  },
};
