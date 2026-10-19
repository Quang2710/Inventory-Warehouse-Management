# Quản lý Kho — Inventory & Warehouse Management (frontend)

Frontend Angular cho hệ thống quản lý tồn kho & kho hàng (SME bán lẻ, phân phối, TMĐT).
Chạy độc lập với **backend giả MSW**; chuyển sang backend thật chỉ cần đổi environment.

## Yêu cầu

- Node.js `^20.19 || ^22.12 || >=24` (Angular 21). Muốn nâng lên Angular 22 cần Node ≥ 22.22.3.
- Google Chrome (cho e2e; hoặc `npx playwright install chromium` rồi đặt `PW_CHANNEL=chromium`).

## Bắt đầu

```bash
npm ci          # cài đúng phiên bản theo package-lock.json
npm start       # http://localhost:4200 — backend giả MSW
```

### Tài khoản demo

| Vai trò            | Tên đăng nhập | Mật khẩu       |
| ------------------ | ------------- | -------------- |
| Quản trị viên      | `admin`       | `Admin@123`    |
| Quản lý kho        | `quanly`      | `Quanly@123`   |
| Nhân viên kho      | `nhanvien`    | `Nhanvien@123` |
| Kế toán / Mua hàng | `ketoan`      | `Ketoan@123`   |

Màn hình đăng nhập có sẵn nút đăng nhập nhanh cho từng tài khoản. Nút ⟲ trên header
(**Reset dữ liệu demo**) khôi phục bộ dữ liệu mẫu ban đầu.

## Lệnh

| Lệnh                 | Mô tả                                                               |
| -------------------- | ------------------------------------------------------------------- |
| `npm start`          | Dev server + backend giả                                            |
| `npm run start:api`  | Dev server gọi backend thật, proxy `/api` → `http://localhost:8080` |
| `npm run build`      | Build production (gọi API thật, **không** chứa code mock)           |
| `npm run build:demo` | Build production kèm backend giả (để deploy bản demo tĩnh)          |
| `npm run test:ci`    | Unit test (Vitest) một lần · `npm test` chạy chế độ watch           |
| `npm run e2e`        | E2E Playwright (tự khởi động dev server ở cổng 4300)                |
| `npm run lint`       | ESLint (angular-eslint + typescript-eslint)                         |
| `npm run format`     | Prettier                                                            |
| `npm run api:gen`    | Sinh lại type TypeScript từ `openapi.yaml`                          |

> Các script gọi thẳng `node node_modules/.../bin` thay vì `ng`/`npx`: đường dẫn dự án chứa ký
> tự `&`, làm hỏng các shim `.cmd` của npm trên Windows. Gõ lệnh Angular CLI bằng
> `npm run ng -- <lệnh>`, ví dụ `npm run ng -- generate component features/x/y`.
>
> npm 10.9.0 có bug (`Cannot read properties of null (reading 'edgesOut')`) khi **thêm** gói mới.
> Dùng `npx npm@11 install <gói>` hoặc nâng npm.

## Kiến trúc

```
openapi.yaml             Contract API (nguồn sự thật cho type)
src/
├── main.ts              Nạp backend giả (dynamic import) khi environment.useMock
├── environments/        development (mock) · production (API thật) · demo · dev-api
├── app/
│   ├── core/            api (type sinh tự động) · auth · guards · interceptors · i18n · theme …
│   ├── shared/          directives (*hasRole, *hasPermission) · ui dùng chung
│   ├── layout/          main-layout · header · sidebar · breadcrumb
│   └── features/        auth · dashboard · system (403/404/đang phát triển)
├── mocks/               MSW: browser · db (@mswjs/data) · seed · persistence (IndexedDB) · handlers
└── testing/             Helper cho unit test
e2e/                     Playwright
```

- **Contract-first**: type trong `src/app/core/api/schema.ts` sinh từ `openapi.yaml` — không sửa tay.
- **Không import mock vào code ứng dụng** (ESLint chặn). Bản build production không chứa mock
  (hằng build-time `MOCK_BACKEND_BUNDLED`).
- **Xác thực**: JWT access + refresh (xoay vòng). Interceptor gắn token, gặp 401 thì refresh
  một lần cho mọi request đồng thời; refresh hỏng → về `/login?returnUrl=…`.
- **Phân quyền**: quyền do server trả về (`/auth/me`). Route dùng `accessGuard` + `routeAccess()`,
  UI dùng `*hasRole` / `*hasPermission`; menu và route dùng chung `MODULE_ACCESS`.
- **i18n** Việt/Anh đổi tức thì (signals); khóa dịch được kiểm tra lúc biên dịch.
  Định dạng nghiệp vụ cố định: VND, `dd/MM/yyyy`, Asia/Ho_Chi_Minh.

## Backend giả (MSW)

- Dữ liệu seed tái lập được (`faker.seed` cố định): 200 sản phẩm, 3 kho, ~380 phiếu nhập/xuất
  trong 120 ngày, ~1.750 biến động tồn, 12 người dùng.
- Tồn kho luôn = tổng `StockMovement`, không âm; giá vốn bình quân gia quyền theo kho.
- Lưu vào IndexedDB (F5 không mất dữ liệu), đồng bộ giữa các tab.
- Giả lập độ trễ 200–600 ms, lỗi 500 ngẫu nhiên ~2 %, 401/403/422.
- Ghi đè khi debug bằng localStorage rồi tải lại trang:

  ```js
  localStorage.setItem('iwm.mock.errorRate', '0'); // tắt lỗi 500 ngẫu nhiên
  localStorage.setItem('iwm.mock.delayMax', '0'); // bỏ độ trễ
  localStorage.setItem('iwm.mock.accessTokenTtl', '30'); // access token sống 30 giây
  ```

## Chuyển sang backend thật

Đặt `useMock: false` và `apiUrl` trong `src/environments/environment*.ts` (hoặc dùng
`npm run start:api` / `npm run build`). Backend cần tuân thủ `openapi.yaml`.

## Quy ước commit

Conventional Commits (commitlint), pre-commit chạy ESLint + Prettier trên file đã stage.
