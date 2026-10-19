import { TemplateRef, ViewContainerRef, inject } from '@angular/core';

/**
 * Dùng chung cho directive cấu trúc kiểu `*hasRole` / `*hasPermission`:
 * hiển thị template chính hoặc template `else`, chỉ vẽ lại khi kết quả thay đổi.
 */
export class ConditionalView {
  private readonly thenTemplate = inject<TemplateRef<unknown>>(TemplateRef);
  private readonly viewContainer = inject(ViewContainerRef);
  private rendered: TemplateRef<unknown> | null | undefined;

  update(condition: boolean, elseTemplate: TemplateRef<unknown> | null): void {
    const next = condition ? this.thenTemplate : elseTemplate;
    if (next === this.rendered) {
      return;
    }
    this.viewContainer.clear();
    if (next) {
      this.viewContainer.createEmbeddedView(next);
    }
    this.rendered = next;
  }
}
