import { type AppEnvironment } from './environment.model';

/** Bản demo (`npm run build:demo`): build production nhưng vẫn dùng backend giả MSW. */
export const environment: AppEnvironment = {
  production: true,
  apiUrl: '/api',
  useMock: true,
  defaultLanguage: 'vi',
};
