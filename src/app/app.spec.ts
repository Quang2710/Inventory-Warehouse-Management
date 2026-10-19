import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { LoadingService } from './core/loading/loading.service';

describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    });
  });

  it('chỉ hiện thanh tiến trình toàn cục khi có request đang chạy', async () => {
    const fixture = TestBed.createComponent(App);
    const loading = TestBed.inject(LoadingService);
    const element = fixture.nativeElement as HTMLElement;

    await fixture.whenStable();
    expect(element.querySelector('mat-progress-bar')).toBeNull();

    loading.start();
    await fixture.whenStable();
    expect(element.querySelector('mat-progress-bar')).not.toBeNull();

    loading.stop();
    await fixture.whenStable();
    expect(element.querySelector('mat-progress-bar')).toBeNull();
  });
});
