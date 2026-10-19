/**
 * Hằng build-time (angular.json → `define`). `true` ở cấu hình development/demo, `false` ở
 * production/dev-api: nhánh nạp mock trong main.ts bị loại hoàn toàn khỏi bundle production.
 */
declare const MOCK_BACKEND_BUNDLED: boolean;
