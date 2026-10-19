import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Trạng thái kết nối mạng của trình duyệt (cập nhật theo sự kiện online/offline). */
@Injectable({ providedIn: 'root' })
export class NetworkStatus {
  private readonly view = inject(DOCUMENT).defaultView;
  private readonly state = signal(this.view?.navigator.onLine ?? true);

  readonly online = this.state.asReadonly();

  constructor() {
    const update = () => this.state.set(this.view?.navigator.onLine ?? true);
    this.view?.addEventListener('online', update);
    this.view?.addEventListener('offline', update);
    inject(DestroyRef).onDestroy(() => {
      this.view?.removeEventListener('online', update);
      this.view?.removeEventListener('offline', update);
    });
  }
}
