import { http, HttpResponse } from 'msw';

import { MOCK_CONFIG } from '../config';
import { db, findById } from '../db';
import { toAuditLog } from '../mappers/document.mapper';
import { authorize } from '../utils/auth';
import { toLocalDate } from '../utils/date';
import { errors } from '../utils/http';
import { inDateRange, matchesFilter, parseListQuery, toPage } from '../utils/query';

const API = MOCK_CONFIG.apiUrl;

export const auditHandlers = [
  http.get(`${API}/audit-logs`, ({ request }) => {
    authorize(request, 'audit:read');
    const query = parseListQuery(new URL(request.url));
    const userId = query.params.get('userId');
    const action = query.params.get('action');
    const entityType = query.params.get('entityType');
    const entityId = query.params.get('entityId');
    const from = query.params.get('from');
    const to = query.params.get('to');
    const items = db.auditLog
      .getAll()
      .filter((entry) => matchesFilter(entry.userId, userId))
      .filter((entry) => matchesFilter(entry.action, action))
      .filter((entry) => matchesFilter(entry.entityType, entityType))
      .filter((entry) => matchesFilter(entry.entityId, entityId))
      .filter((entry) => inDateRange(toLocalDate(new Date(entry.occurredAt)), from, to))
      .map(toAuditLog);
    return HttpResponse.json(
      toPage(items, query, {
        sortable: ['occurredAt', 'userName', 'action', 'entityType'],
        defaultSort: 'occurredAt,desc',
        searchIn: (entry) => [entry.summary, entry.userName, entry.entityLabel],
      }),
    );
  }),

  http.get(`${API}/audit-logs/:id`, ({ request, params }) => {
    authorize(request, 'audit:read');
    const entry = findById('auditLog', String(params['id']));
    if (!entry) {
      throw errors.notFound('Không tìm thấy bản ghi nhật ký.');
    }
    return HttpResponse.json(toAuditLog(entry));
  }),
];
