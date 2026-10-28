import { type AppEnvironment } from './environment.model';

/** Development (`npm start`): chạy với backend giả MSW. */
export const environment: AppEnvironment = {
  production: false,
  apiUrl: '/api',
  useMock: true,
  defaultLanguage: 'vi',
  serviceWorker: { enabled: false, script: 'ngsw-worker.js' },
};
