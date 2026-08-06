export class QueryShaper extends HTMLElement {
  static readonly tagName = "query-shaper";

  get target(): HTMLInputElement | null {
    const forId = this.getAttribute("for");
    if (!forId) return null;
    const el = document.getElementById(forId);
    return el instanceof HTMLInputElement ? el : null;
  }

  connectedCallback(): void {
    this.target?.setAttribute("autocomplete", "off");
  }
}

if (!customElements.get(QueryShaper.tagName)) {
  customElements.define(QueryShaper.tagName, QueryShaper);
}
