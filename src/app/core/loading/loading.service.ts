import { Injectable, computed, signal } from '@angular/core';

/** Đếm request đang chạy để hiện thanh tiến trình mảnh ở đầu trang (không phủ toàn trang). */
@Injectable({ providedIn: 'root' })
export class LoadingService {
  private readonly pending = signal(0);

  readonly isLoading = computed(() => this.pending() > 0);

  start(): void {
    this.pending.update((count) => count + 1);
  }

  stop(): void {
    this.pending.update((count) => Math.max(0, count - 1));
  }
}
