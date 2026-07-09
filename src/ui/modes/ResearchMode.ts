import { Mode } from "./Mode";

export class ResearchMode extends Mode {
  readonly id = "research";
  readonly title = "Research";
  readonly icon = "🔬";

  render(): HTMLElement {
    const el = document.createElement("div");
    el.innerHTML = `
      <div style="padding:24px">
        <h2>Research Mode</h2>
        <p>Coming Soon...</p>
      </div>
    `;
    return el;
  }
}
