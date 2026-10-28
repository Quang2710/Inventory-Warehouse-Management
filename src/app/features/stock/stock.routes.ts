import type { Routes } from '@angular/router';

import { SerialsPage } from './pages/serials-page';
import { StockItemsPage } from './pages/stock-items-page';
import { StockLotsPage } from './pages/stock-lots-page';
import { StockShell } from './stock-shell';

export default [
  {
    path: '',
    component: StockShell,
    children: [
      { path: '', component: StockItemsPage },
      {
        path: 'lots',
        component: StockLotsPage,
        title: 'stock.tabs.lots',
        data: { breadcrumb: 'stock.tabs.lots' },
      },
      {
        path: 'serials',
        component: SerialsPage,
        title: 'stock.tabs.serials',
        data: { breadcrumb: 'stock.tabs.serials' },
      },
    ],
  },
] satisfies Routes;
