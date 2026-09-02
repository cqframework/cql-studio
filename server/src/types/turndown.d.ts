declare module 'turndown' {
  export default class TurndownService {
    constructor(options?: { headingStyle?: string });
    turndown(html: string | Node): string;
  }
}
