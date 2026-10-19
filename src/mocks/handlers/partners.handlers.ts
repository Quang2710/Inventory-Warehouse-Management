import { http, HttpResponse } from 'msw';

import type {
  CustomerRequest,
  CustomerType,
  PartnerStatus,
  SupplierRequest,
} from '../../app/core/api/schema';
import { MOCK_CONFIG } from '../config';
import { db, findById, type CustomerEntity, type SupplierEntity } from '../db';
import { recordAudit } from '../domain/audit';
import { toCustomer, toSupplier } from '../mappers/document.mapper';
import { authorize } from '../utils/auth';
import { nowIso } from '../utils/date';
import { cleanText, EMAIL_PATTERN, errors, noContent, readJson, Validator } from '../utils/http';
import { matchesFilter, parseListQuery, toPage } from '../utils/query';

const API = MOCK_CONFIG.apiUrl;
const CODE = /^[A-Z0-9-]{2,20}$/;
const TAX_CODE = /^[0-9]{10}(-[0-9]{3})?$/;
const PHONE = /^[0-9+ ]{8,15}$/;
const STATUSES: readonly PartnerStatus[] = ['ACTIVE', 'INACTIVE'];
const CUSTOMER_TYPES: readonly CustomerType[] = ['RETAIL', 'WHOLESALE', 'ONLINE'];

type PartnerBody = Partial<SupplierRequest & CustomerRequest>;

/** Kiểm tra các trường chung của đối tác. */
function validatePartner(body: PartnerBody, codeTaken: boolean): Validator {
  const validator = new Validator()
    .require('code', body.code, 'Vui lòng nhập mã.')
    .require('name', body.name, 'Vui lòng nhập tên.');
  if (body.code && !CODE.test(body.code)) {
    validator.add('code', 'Mã gồm 2–20 ký tự in hoa, số hoặc "-".');
  } else if (codeTaken) {
    validator.add('code', 'Mã đã tồn tại.');
  }
  if (body.name && body.name.length > 200) validator.add('name', 'Tên tối đa 200 ký tự.');
  if (body.taxCode && !TAX_CODE.test(body.taxCode))
    validator.add('taxCode', 'Mã số thuế gồm 10 số hoặc 10 số + "-" + 3 số.');
  if (body.phone && !PHONE.test(body.phone)) validator.add('phone', 'Số điện thoại không hợp lệ.');
  if (body.email && !EMAIL_PATTERN.test(body.email)) validator.add('email', 'Email không hợp lệ.');
  if (!body.status || !STATUSES.includes(body.status))
    validator.add('status', 'Trạng thái không hợp lệ.');
  return validator;
}

function contactFields(body: PartnerBody) {
  return {
    code: body.code!,
    name: body.name!.trim(),
    taxCode: cleanText(body.taxCode),
    contactName: cleanText(body.contactName),
    phone: cleanText(body.phone),
    email: cleanText(body.email),
    address: cleanText(body.address),
    status: body.status!,
    note: cleanText(body.note),
  };
}

function supplierSnapshot(supplier: SupplierEntity) {
  const { code, name, taxCode, contactName, phone, email, address, paymentTermDays, status, note } =
    supplier;
  return { code, name, taxCode, contactName, phone, email, address, paymentTermDays, status, note };
}

function customerSnapshot(customer: CustomerEntity) {
  const { code, name, type, taxCode, contactName, phone, email, address, status, note } = customer;
  return { code, name, type, taxCode, contactName, phone, email, address, status, note };
}

function receiptCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const receipt of db.goodsReceipt.getAll()) {
    if (receipt.supplierId)
      counts.set(receipt.supplierId, (counts.get(receipt.supplierId) ?? 0) + 1);
  }
  return counts;
}

function issueCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const issue of db.goodsIssue.getAll()) {
    if (issue.customerId) counts.set(issue.customerId, (counts.get(issue.customerId) ?? 0) + 1);
  }
  return counts;
}

function requireSupplier(id: string): SupplierEntity {
  const supplier = findById('supplier', id);
  if (!supplier) throw errors.notFound('Không tìm thấy nhà cung cấp.');
  return supplier;
}

function requireCustomer(id: string): CustomerEntity {
  const customer = findById('customer', id);
  if (!customer) throw errors.notFound('Không tìm thấy khách hàng.');
  return customer;
}

export const partnerHandlers = [
  // ── Nhà cung cấp ──
  http.get(`${API}/suppliers`, ({ request }) => {
    authorize(request, 'supplier:read');
    const query = parseListQuery(new URL(request.url));
    const status = query.params.get('status');
    const counts = receiptCounts();
    const items = db.supplier
      .getAll()
      .filter((supplier) => matchesFilter(supplier.status, status))
      .map((supplier) => toSupplier(supplier, counts.get(supplier.id) ?? 0));
    return HttpResponse.json(
      toPage(items, query, {
        sortable: ['code', 'name', 'paymentTermDays', 'status', 'receiptCount', 'createdAt'],
        defaultSort: 'code,asc',
        searchIn: (supplier) => [
          supplier.code,
          supplier.name,
          supplier.taxCode,
          supplier.phone,
          supplier.contactName,
        ],
      }),
    );
  }),

  http.post(`${API}/suppliers`, async ({ request }) => {
    const user = authorize(request, 'supplier:write');
    const body = await readJson<SupplierRequest>(request);
    const validator = validatePartner(
      body,
      db.supplier.getAll().some((item) => item.code === body.code),
    );
    if (!(
      Number.isInteger(body.paymentTermDays) &&
      body.paymentTermDays! >= 0 &&
      body.paymentTermDays! <= 365
    )) {
      validator.add('paymentTermDays', 'Số ngày công nợ từ 0 đến 365.');
    }
    validator.throwIfInvalid();
    const now = nowIso();
    const supplier = db.supplier.create({
      ...contactFields(body),
      paymentTermDays: body.paymentTermDays!,
      createdAt: now,
      updatedAt: now,
    });
    recordAudit({
      actor: user,
      action: 'CREATE',
      entityType: 'SUPPLIER',
      entityId: supplier.id,
      entityLabel: supplier.code,
      summary: `Tạo nhà cung cấp ${supplier.name}`,
      after: supplierSnapshot(supplier),
    });
    return HttpResponse.json(toSupplier(supplier, 0), { status: 201 });
  }),

  http.get(`${API}/suppliers/:id`, ({ request, params }) => {
    authorize(request, 'supplier:read');
    const supplier = requireSupplier(String(params['id']));
    return HttpResponse.json(toSupplier(supplier, receiptCounts().get(supplier.id) ?? 0));
  }),

  http.put(`${API}/suppliers/:id`, async ({ request, params }) => {
    const user = authorize(request, 'supplier:write');
    const supplier = requireSupplier(String(params['id']));
    const body = await readJson<SupplierRequest>(request);
    const validator = validatePartner(
      body,
      db.supplier.getAll().some((item) => item.code === body.code && item.id !== supplier.id),
    );
    if (!(
      Number.isInteger(body.paymentTermDays) &&
      body.paymentTermDays! >= 0 &&
      body.paymentTermDays! <= 365
    )) {
      validator.add('paymentTermDays', 'Số ngày công nợ từ 0 đến 365.');
    }
    validator.throwIfInvalid();
    const updated = db.supplier.update({
      where: { id: { equals: supplier.id } },
      data: { ...contactFields(body), paymentTermDays: body.paymentTermDays!, updatedAt: nowIso() },
    })!;
    recordAudit({
      actor: user,
      action: 'UPDATE',
      entityType: 'SUPPLIER',
      entityId: updated.id,
      entityLabel: updated.code,
      summary: `Cập nhật nhà cung cấp ${updated.name}`,
      before: supplierSnapshot(supplier),
      after: supplierSnapshot(updated),
    });
    return HttpResponse.json(toSupplier(updated, receiptCounts().get(updated.id) ?? 0));
  }),

  http.delete(`${API}/suppliers/:id`, ({ request, params }) => {
    const user = authorize(request, 'supplier:write');
    const supplier = requireSupplier(String(params['id']));
    const used = receiptCounts().get(supplier.id) ?? 0;
    if (used > 0) {
      throw errors.conflict(
        `Nhà cung cấp đã phát sinh ${used} phiếu nhập — hãy chuyển sang Ngừng giao dịch.`,
      );
    }
    db.supplier.delete({ where: { id: { equals: supplier.id } } });
    recordAudit({
      actor: user,
      action: 'DELETE',
      entityType: 'SUPPLIER',
      entityId: supplier.id,
      entityLabel: supplier.code,
      summary: `Xóa nhà cung cấp ${supplier.name}`,
      before: supplierSnapshot(supplier),
    });
    return noContent();
  }),

  // ── Khách hàng ──
  http.get(`${API}/customers`, ({ request }) => {
    authorize(request, 'customer:read');
    const query = parseListQuery(new URL(request.url));
    const status = query.params.get('status');
    const type = query.params.get('type');
    const counts = issueCounts();
    const items = db.customer
      .getAll()
      .filter((customer) => matchesFilter(customer.status, status))
      .filter((customer) => matchesFilter(customer.type, type))
      .map((customer) => toCustomer(customer, counts.get(customer.id) ?? 0));
    return HttpResponse.json(
      toPage(items, query, {
        sortable: ['code', 'name', 'type', 'status', 'issueCount', 'createdAt'],
        defaultSort: 'code,asc',
        searchIn: (customer) => [
          customer.code,
          customer.name,
          customer.taxCode,
          customer.phone,
          customer.contactName,
        ],
      }),
    );
  }),

  http.post(`${API}/customers`, async ({ request }) => {
    const user = authorize(request, 'customer:write');
    const body = await readJson<CustomerRequest>(request);
    const validator = validatePartner(
      body,
      db.customer.getAll().some((item) => item.code === body.code),
    );
    if (!body.type || !CUSTOMER_TYPES.includes(body.type))
      validator.add('type', 'Vui lòng chọn loại khách hàng.');
    validator.throwIfInvalid();
    const now = nowIso();
    const customer = db.customer.create({
      ...contactFields(body),
      type: body.type!,
      createdAt: now,
      updatedAt: now,
    });
    recordAudit({
      actor: user,
      action: 'CREATE',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      entityLabel: customer.code,
      summary: `Tạo khách hàng ${customer.name}`,
      after: customerSnapshot(customer),
    });
    return HttpResponse.json(toCustomer(customer, 0), { status: 201 });
  }),

  http.get(`${API}/customers/:id`, ({ request, params }) => {
    authorize(request, 'customer:read');
    const customer = requireCustomer(String(params['id']));
    return HttpResponse.json(toCustomer(customer, issueCounts().get(customer.id) ?? 0));
  }),

  http.put(`${API}/customers/:id`, async ({ request, params }) => {
    const user = authorize(request, 'customer:write');
    const customer = requireCustomer(String(params['id']));
    const body = await readJson<CustomerRequest>(request);
    const validator = validatePartner(
      body,
      db.customer.getAll().some((item) => item.code === body.code && item.id !== customer.id),
    );
    if (!body.type || !CUSTOMER_TYPES.includes(body.type))
      validator.add('type', 'Vui lòng chọn loại khách hàng.');
    validator.throwIfInvalid();
    const updated = db.customer.update({
      where: { id: { equals: customer.id } },
      data: { ...contactFields(body), type: body.type!, updatedAt: nowIso() },
    })!;
    recordAudit({
      actor: user,
      action: 'UPDATE',
      entityType: 'CUSTOMER',
      entityId: updated.id,
      entityLabel: updated.code,
      summary: `Cập nhật khách hàng ${updated.name}`,
      before: customerSnapshot(customer),
      after: customerSnapshot(updated),
    });
    return HttpResponse.json(toCustomer(updated, issueCounts().get(updated.id) ?? 0));
  }),

  http.delete(`${API}/customers/:id`, ({ request, params }) => {
    const user = authorize(request, 'customer:write');
    const customer = requireCustomer(String(params['id']));
    const used = issueCounts().get(customer.id) ?? 0;
    if (used > 0) {
      throw errors.conflict(
        `Khách hàng đã phát sinh ${used} phiếu xuất — hãy chuyển sang Ngừng giao dịch.`,
      );
    }
    db.customer.delete({ where: { id: { equals: customer.id } } });
    recordAudit({
      actor: user,
      action: 'DELETE',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      entityLabel: customer.code,
      summary: `Xóa khách hàng ${customer.name}`,
      before: customerSnapshot(customer),
    });
    return noContent();
  }),
];
