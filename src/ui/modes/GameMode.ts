import { Mode } from "./Mode";

export class GameMode extends Mode {
  readonly id = "game";
  readonly title = "Games";
  readonly icon = "🎮";

  render(): HTMLElement {
    const el = document.createElement("div");
    el.innerHTML = `
      <div style="padding:24px">
        <h2>Game Mode</h2>
        <p>Coming Soon...</p>
      </div>
    `;
    return el;
  }
}
