import type { Role } from '../api';

/**
 * Tài khoản demo — CHỈ tồn tại ở chế độ backend giả (`/__demo/accounts`),
 * không thuộc contract `openapi.yaml` của backend thật.
 */
export interface DemoAccount {
  username: string;
  password: string;
  fullName: string;
  role: Role;
}
