import { type AppEnvironment } from './environment.model';

/** Development với backend thật (`npm run start:api`), proxy `/api` → http://localhost:8080. */
export const environment: AppEnvironment = {
  production: false,
  apiUrl: '/api',
  useMock: false,
  defaultLanguage: 'vi',
};
