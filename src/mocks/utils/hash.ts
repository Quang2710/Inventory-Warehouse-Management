/**
 * Băm FNV-1a 32-bit (hex). CHỈ dùng cho backend giả — không phải hàm băm mật mã.
 */
export function fnv1a(input: string, seed = 0x811c9dc5): string {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function hashPassword(username: string, password: string): string {
  const material = `${username.toLowerCase()}:${password}:iwm-mock-salt`;
  return `fnv$${fnv1a(material)}${fnv1a(material, 0x01000193)}`;
}

export function verifyPassword(username: string, password: string, passwordHash: string): boolean {
  return hashPassword(username, password) === passwordHash;
}
