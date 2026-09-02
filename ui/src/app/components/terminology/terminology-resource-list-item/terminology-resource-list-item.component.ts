// Author: Preston Lee

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-terminology-resource-list-item',
  imports: [],
  templateUrl: './terminology-resource-list-item.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminologyResourceListItemComponent {
  readonly name = input<string | undefined>();
  readonly title = input<string | undefined>();
  readonly url = input<string | undefined>();
  readonly version = input<string | undefined>();
  readonly status = input<string | undefined>();
  readonly active = input(false);
  readonly unnamedFallback = input('Unnamed Resource');
  /** When true, always render a title line (uses N/A if title is empty). */
  readonly showTitleFallback = input(true);
  /** When false, hide the version chip entirely (ConceptMap). */
  readonly showVersion = input(true);
  /** When true, always show a version chip (uses N/A if empty). */
  readonly showVersionFallback = input(false);
  /** When true, show "Unknown" if status is missing. */
  readonly showStatusFallback = input(false);
  readonly showClipboard = input(false);
  readonly clipboardButtonId = input<string | undefined>();
  readonly clipboardTitle = input('Add to Clipboard');

  readonly selected = output<void>();
  readonly addToClipboard = output<MouseEvent>();

  protected onClipboardClick(event: MouseEvent): void {
    event.stopPropagation();
    this.addToClipboard.emit(event);
  }

  protected onUrlClick(event: MouseEvent): void {
    event.stopPropagation();
  }
}
