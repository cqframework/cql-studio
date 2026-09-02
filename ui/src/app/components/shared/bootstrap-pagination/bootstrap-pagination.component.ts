// Author: Preston Lee

import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-bootstrap-pagination',
  imports: [],
  templateUrl: './bootstrap-pagination.component.html',
})
export class BootstrapPaginationComponent {
  readonly currentPage = input.required<number>();
  readonly totalPages = input.required<number>();
  readonly startIndex = input.required<number>();
  readonly endIndex = input.required<number>();
  readonly totalCount = input.required<number>();
  readonly hasPrevious = input.required<boolean>();
  readonly hasNext = input.required<boolean>();
  readonly ariaLabel = input('Page navigation');
  readonly idPrefix = input('pagination');

  readonly goFirst = output<void>();
  readonly goPrevious = output<void>();
  readonly goNext = output<void>();
  readonly goLast = output<void>();
}
