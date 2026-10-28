import { drop, ENTITY_TYPE, PRIMARY_KEY } from '@mswjs/data';

import { MOCK_CONFIG } from './config';
import { db, type ModelName } from './db';
import { seedDatabase, type SeedSummary } from './seed';

/**
 * Lưu bền db giả vào IndexedDB để F5 không mất dữ liệu.
 *
 * Snapshot lưu từng bản ghi; quan hệ (oneOf/manyOf) được thay bằng tham chiếu
 * `{ $ref: model, id }` và dựng lại đúng thứ tự phụ thuộc khi khôi phục.
 */

/** Thứ tự tạo lại: model được tham chiếu phải đứng trước model tham chiếu nó. */
const MODEL_ORDER = [
  'user',
  'roleDefinition',
  'session',
  'category',
  'warehouse',
  'location',
  'product',
  'supplier',
  'customer',
  'stockItem',
  'binStock',
  'stockLot',
  'serialUnit',
  'goodsReceiptLine',
  'goodsReceipt',
  'goodsIssueLine',
  'goodsIssue',
  'transfer',
  'transferLine',
  'stocktake',
  'stocktakeLine',
  'stockMovement',
  'auditLog',
  'counter',
] as const satisfies readonly ModelName[];

// Báo lỗi biên dịch khi thêm model vào db.ts mà quên khai báo thứ tự ở trên.
type UnorderedModel = Exclude<ModelName, (typeof MODEL_ORDER)[number]>;
const allModelsOrdered: UnorderedModel extends never ? true : UnorderedModel = true;
void allModelsOrdered;

interface EntityRef {
  $ref: string;
  id: string;
}

type Primitive = string | number | boolean;
type SerializedValue = Primitive | null | EntityRef | EntityRef[] | Primitive[];
type SerializedRecord = Record<string, SerializedValue>;

interface Snapshot {
  version: number;
  seed: number;
  savedAt: string;
  models: Partial<Record<ModelName, SerializedRecord[]>>;
}

type AnyEntity = Record<string | symbol, unknown> & {
  [ENTITY_TYPE]: string;
  [PRIMARY_KEY]: string;
};

/** API tối thiểu của một model, dùng khi thao tác generic theo tên model. */
interface LooseModelApi {
  getAll(): AnyEntity[];
  create(data: Record<string, unknown>): AnyEntity;
  update(query: { where: { id: { equals: string } }; data: Record<string, unknown> }): unknown;
}

const STORE_NAME = 'snapshots';
const SNAPSHOT_KEY = 'db';

function modelApi(model: ModelName): LooseModelApi {
  return db[model] as unknown as LooseModelApi;
}

function isEntity(value: unknown): value is AnyEntity {
  return typeof value === 'object' && value !== null && ENTITY_TYPE in value;
}

function isRef(value: unknown): value is EntityRef {
  return typeof value === 'object' && value !== null && '$ref' in value && 'id' in value;
}

function toRef(entity: AnyEntity): EntityRef {
  const primaryKey = entity[PRIMARY_KEY];
  return { $ref: entity[ENTITY_TYPE], id: String(entity[primaryKey]) };
}

function serializeEntity(entity: AnyEntity): SerializedRecord {
  const record: SerializedRecord = {};
  for (const [key, value] of Object.entries(entity)) {
    if (isEntity(value)) {
      record[key] = toRef(value);
    } else if (Array.isArray(value)) {
      // manyOf → danh sách tham chiếu; mảng giá trị nguyên thủy (vd warehouseIds) giữ nguyên.
      record[key] = value.some(isEntity)
        ? value.filter(isEntity).map(toRef)
        : (value as Primitive[]).slice();
    } else if (value === undefined) {
      record[key] = null;
    } else {
      record[key] = value as SerializedValue;
    }
  }
  return record;
}

export function createSnapshot(): Snapshot {
  const models: Snapshot['models'] = {};
  for (const model of MODEL_ORDER) {
    models[model] = modelApi(model).getAll().map(serializeEntity);
  }
  return {
    version: MOCK_CONFIG.snapshotVersion,
    seed: MOCK_CONFIG.seed,
    savedAt: new Date().toISOString(),
    models,
  };
}

export function restoreSnapshot(snapshot: Snapshot): void {
  drop(db);
  const created = new Map<string, Map<string, AnyEntity>>();
  const deferred: (() => void)[] = [];
  const lookup = (ref: EntityRef): AnyEntity | undefined => created.get(ref.$ref)?.get(ref.id);

  for (const model of MODEL_ORDER) {
    const index = new Map<string, AnyEntity>();
    created.set(model, index);
    for (const record of snapshot.models[model] ?? []) {
      const data: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        if (isRef(value)) {
          const target = lookup(value);
          if (target) {
            data[key] = target;
          } else if (value.$ref === model) {
            // Tự tham chiếu tới bản ghi tạo sau (vd danh mục cha) → gán lại ở lượt sau.
            data[key] = null;
            deferred.push(() => {
              modelApi(model).update({
                where: { id: { equals: String(record['id']) } },
                data: { [key]: lookup(value) ?? null },
              });
            });
          } else {
            throw new Error(
              `Snapshot hỏng: ${model}.${key} tham chiếu ${value.$ref}#${value.id} không tồn tại`,
            );
          }
        } else if (Array.isArray(value) && !value.every(isRef)) {
          data[key] = value.slice();
        } else if (Array.isArray(value)) {
          data[key] = (value as EntityRef[]).map((ref) => {
            const target = lookup(ref);
            if (!target) {
              throw new Error(
                `Snapshot hỏng: ${model}.${key} tham chiếu ${ref.$ref}#${ref.id} không tồn tại`,
              );
            }
            return target;
          });
        } else {
          data[key] = value;
        }
      }
      const entity = modelApi(model).create(data);
      index.set(String(record['id']), entity);
    }
  }
  deferred.forEach((apply) => apply());
}

// ───────────────────────────── IndexedDB ─────────────────────────────

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MOCK_CONFIG.indexedDbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openIndexedDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = run(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function readSnapshot(): Promise<Snapshot | null> {
  const value = await withStore<unknown>('readonly', (store) => store.get(SNAPSHOT_KEY));
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const snapshot = value as Snapshot;
  return snapshot.version === MOCK_CONFIG.snapshotVersion && snapshot.seed === MOCK_CONFIG.seed
    ? snapshot
    : null;
}

async function writeSnapshot(snapshot: Snapshot): Promise<void> {
  await withStore('readwrite', (store) => store.put(snapshot, SNAPSHOT_KEY));
}

// ───────────────────────────── API ─────────────────────────────

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let indexedDbAvailable = typeof indexedDB !== 'undefined';
/** Mốc snapshot mà db trong bộ nhớ của tab này đang phản ánh. */
let currentSavedAt: string | null = null;

/** Báo cho các tab khác nạp lại snapshot sau khi tab này ghi — tránh ghi đè dữ liệu lẫn nhau. */
let channel: BroadcastChannel | null | undefined;
function syncChannel(): BroadcastChannel | null {
  channel ??=
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('iwm-mock-db-sync') : null;
  return channel;
}

interface SyncMessage {
  type: 'snapshot-saved';
  savedAt: string;
}

function logSeed(summary: SeedSummary): void {
  console.info(
    `[mock] Đã sinh dữ liệu demo trong ${summary.durationMs}ms: ` +
      `${summary.products} sản phẩm, ${summary.warehouses} kho, ` +
      `${summary.goodsReceipts} phiếu nhập, ${summary.goodsIssues} phiếu xuất, ` +
      `${summary.stockMovements} biến động tồn, ${summary.users} người dùng.`,
  );
}

export async function persistNow(): Promise<void> {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (!indexedDbAvailable) {
    return;
  }
  try {
    const snapshot = createSnapshot();
    await writeSnapshot(snapshot);
    currentSavedAt = snapshot.savedAt;
    syncChannel()?.postMessage({
      type: 'snapshot-saved',
      savedAt: snapshot.savedAt,
    } satisfies SyncMessage);
  } catch (error) {
    console.warn('[mock] Không lưu được dữ liệu vào IndexedDB:', error);
  }
}

/** Gom nhiều thay đổi liên tiếp thành một lần ghi IndexedDB. */
export function schedulePersist(delayMs = 300): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => void persistNow(), delayMs);
}

/** Nạp snapshot từ IndexedDB; nếu chưa có/khác phiên bản/hỏng thì seed mới. */
export async function initDatabase(): Promise<'restored' | 'seeded'> {
  if (indexedDbAvailable) {
    try {
      const snapshot = await readSnapshot();
      if (snapshot) {
        restoreSnapshot(snapshot);
        currentSavedAt = snapshot.savedAt;
        console.info(`[mock] Đã khôi phục dữ liệu từ IndexedDB (lưu lúc ${snapshot.savedAt}).`);
        return 'restored';
      }
    } catch (error) {
      console.warn('[mock] Không đọc được snapshot, sinh lại dữ liệu demo.', error);
      indexedDbAvailable = typeof indexedDB !== 'undefined';
    }
  } else {
    console.warn('[mock] Trình duyệt không hỗ trợ IndexedDB — dữ liệu sẽ mất khi tải lại trang.');
  }
  drop(db);
  logSeed(seedDatabase());
  await persistNow();
  return 'seeded';
}

/** Xóa toàn bộ dữ liệu và sinh lại bộ demo ban đầu. */
export async function resetDatabase(): Promise<void> {
  drop(db);
  logSeed(seedDatabase());
  await persistNow();
}

/** Lắng nghe tab khác ghi snapshot để nạp lại db trong bộ nhớ của tab này. */
export function watchOtherTabs(): void {
  syncChannel()?.addEventListener('message', (event: MessageEvent<SyncMessage>) => {
    if (event.data?.type !== 'snapshot-saved' || event.data.savedAt === currentSavedAt) {
      return;
    }
    void readSnapshot()
      .then((snapshot) => {
        if (snapshot && snapshot.savedAt !== currentSavedAt) {
          restoreSnapshot(snapshot);
          currentSavedAt = snapshot.savedAt;
        }
      })
      .catch((error: unknown) =>
        console.warn('[mock] Không đồng bộ được dữ liệu từ tab khác:', error),
      );
  });
}
