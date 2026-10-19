/**
 * Bọc IndexedDB tối giản (Promise) cho dữ liệu offline của ứng dụng.
 * Không dùng thư viện ngoài; một database, các object store khai báo sẵn.
 */
export class IdbStore<T> {
  constructor(
    private readonly databaseName: string,
    private readonly storeName: string,
    private readonly allStores: readonly string[],
    private readonly version = 1,
  ) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB không khả dụng'));
        return;
      }
      const request = indexedDB.open(this.databaseName, this.version);
      request.onupgradeneeded = () => {
        for (const name of this.allStores) {
          if (!request.result.objectStoreNames.contains(name)) {
            request.result.createObjectStore(name);
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async run<R>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<R>,
  ): Promise<R> {
    const database = await this.open();
    try {
      return await new Promise<R>((resolve, reject) => {
        const transaction = database.transaction(this.storeName, mode);
        const request = action(transaction.objectStore(this.storeName));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  async get(key: string): Promise<T | undefined> {
    return (await this.run('readonly', (store) => store.get(key))) as T | undefined;
  }

  async getAll(): Promise<T[]> {
    return (await this.run('readonly', (store) => store.getAll())) as T[];
  }

  async put(key: string, value: T): Promise<void> {
    await this.run('readwrite', (store) => store.put(value, key));
  }

  async delete(key: string): Promise<void> {
    await this.run('readwrite', (store) => store.delete(key));
  }
}
