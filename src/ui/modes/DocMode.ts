import { Mode } from "./Mode";

export class DocMode extends Mode {
  readonly id = "doc";
  readonly title = "Documents";
  readonly icon = "📄";

  render(): HTMLElement {
    const el = document.createElement("div");
    el.innerHTML = `
      <div style="padding:24px">
        <h2>Document Mode</h2>
        <p>Coming Soon...</p>
      </div>
    `;
    return el;
  }
}
