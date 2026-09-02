// Author: Preston Lee

import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpHeaders } from '@angular/common/http';

@Injectable({
	providedIn: 'root'
})
export abstract class BaseService {

  public static LOCAL_STORAGE_BEARER_TOKEN_KEY: string = 'jwt';

  protected http = inject(HttpClient);

	public includeBearerToken: boolean = false;
	public headers(): HttpHeaders {
		var headers = new HttpHeaders({ 'Content-Type': 'application/json', 'Accept': 'application/json' });
		if (this.includeBearerToken) {
			let jwt = localStorage.getItem(BaseService.LOCAL_STORAGE_BEARER_TOKEN_KEY);
			if (jwt) {
				headers = headers.set('Authorization', 'Bearer ' + jwt);
			}
		}
		return headers;
	}

  formatErrors(errors: { [field: string]: Array<string> }): string[] {
    let formatted: string[] = [];
    for (let [key, msgs] of Object.entries(errors)) {
      msgs.forEach(msg => {
        formatted.push(key + ' ' + msg);
      });
    }
    return formatted;
  }

  formatErrorsHtml(errors: { [field: string]: Array<string> }): string {
    let html = '<ul>';
    for (let e of this.formatErrors(errors)) {
      html += '<li>' + e + '</li>';
    }
    html += '</ul>'
    return html;
  }

  formatErrorsText(errors: { [field: string]: Array<string> }): string {
    let text = this.formatErrors(errors).join(', ');
    return text;
  }

  toLowercaseLabel(text: string) {
    let matches = text.toLowerCase().match(/[a-z0-9-]/g);
    if (matches) {
      return matches.join('');
    } else {
      return '';
    }
  }
}
