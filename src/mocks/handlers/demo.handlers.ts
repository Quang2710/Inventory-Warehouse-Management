import { http, HttpResponse } from 'msw';

import type { DemoAccount } from '../../app/core/demo/demo.models';
import { MOCK_CONFIG } from '../config';
import { DEMO_ACCOUNTS } from '../data/demo-accounts';
import { recordAudit } from '../domain/audit';
import { persistNow, resetDatabase } from '../persistence';

const API = MOCK_CONFIG.apiUrl;

/** Endpoint chỉ có ở backend giả — không thuộc contract openapi.yaml. */
export const demoHandlers = [
  http.get(`${API}/__demo/accounts`, () =>
    HttpResponse.json<DemoAccount[]>(
      DEMO_ACCOUNTS.map(({ username, password, fullName, role }) => ({
        username,
        password,
        fullName,
        role,
      })),
    ),
  ),

  http.post(`${API}/__demo/reset`, async () => {
    await resetDatabase();
    recordAudit({
      actor: null,
      action: 'DATA_RESET',
      entityType: 'SYSTEM',
      summary: 'Khôi phục bộ dữ liệu demo ban đầu',
    });
    await persistNow();
    return new HttpResponse(null, { status: 204 });
  }),
];
