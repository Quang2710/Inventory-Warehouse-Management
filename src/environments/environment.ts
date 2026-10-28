import { type AppEnvironment } from './environment.model';

/** Production: gọi backend thật. */
export const environment: AppEnvironment = {
  production: true,
  apiUrl: '/api',
  useMock: false,
  defaultLanguage: 'vi',
  serviceWorker: { enabled: true, script: 'ngsw-worker.js' },
};
