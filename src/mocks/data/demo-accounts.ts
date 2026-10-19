import type { DemoAccount } from '../../app/core/demo/demo.models';

/** 4 tài khoản demo — mỗi vai trò một tài khoản. */
export const DEMO_ACCOUNTS: readonly (DemoAccount & { email: string; phone: string })[] = [
  {
    username: 'admin',
    password: 'Admin@123',
    fullName: 'Nguyễn Văn An',
    role: 'ADMIN',
    email: 'admin@example.com',
    phone: '0901000001',
  },
  {
    username: 'quanly',
    password: 'Quanly@123',
    fullName: 'Trần Thị Bình',
    role: 'WAREHOUSE_MANAGER',
    email: 'quanly@example.com',
    phone: '0901000002',
  },
  {
    username: 'nhanvien',
    password: 'Nhanvien@123',
    fullName: 'Lê Văn Cường',
    role: 'WAREHOUSE_STAFF',
    email: 'nhanvien@example.com',
    phone: '0901000003',
  },
  {
    username: 'ketoan',
    password: 'Ketoan@123',
    fullName: 'Phạm Thu Dung',
    role: 'ACCOUNTANT',
    email: 'ketoan@example.com',
    phone: '0901000004',
  },
];
