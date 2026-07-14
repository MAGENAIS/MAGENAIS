/**
 * Ported from the legacy monolith's generateGame two-agent pipeline:
 * a "structure agent" builds HTML/CSS scaffolding with a placeholder comment,
 * then a "logic agent" writes the JS that fills that placeholder — matching the
 * monolith's approach of keeping each generation call focused and small enough
 * for a text model to reliably produce complete, working output in one pass.
 */

export type LogFn = (message: string, level?: 'info' | 'warn' | 'error') => void;
export type TextCaller = (prompt: string, opts?: Record<string, any>) => Promise<string>;

export interface GameOptions {
  concept: string;
  engine: '2d' | '3d';
  genre?: string;
  complexity?: 'minimal' | 'standard' | 'rich';
  iterate?: boolean;
  previousCode?: string;
}

function buildGameIteratePrompt(currentCode: string, changeRequest: string): string {
  return `Here is the complete current HTML/JS source of a small browser game:

\`\`\`html
${currentCode}
\`\`\`

Apply this change request to it: "${changeRequest}"

Output ONLY the full, complete, updated HTML document (starting with <!DOCTYPE html>, ending with </html>) with the requested change applied — no explanation, no markdown code fences. Keep everything else about the game working exactly as before unless the change naturally requires touching it. Make sure the result is still a single self-contained file.`;
}

function extractGameHtml(raw: string): string {
  let html = raw.trim();
  const fenceMatch = html.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fenceMatch) html = fenceMatch[1].trim();
  const doctypeIdx = html.search(/<!DOCTYPE html>/i);
  if (doctypeIdx > 0) html = html.slice(doctypeIdx);
  const hasDoctype = /<!DOCTYPE html>/i.test(html);
  const hasClosingHtml = /<\/html>/i.test(html);
  if (!hasDoctype || !hasClosingHtml) {
    const preview = raw.trim().slice(0, 140).replace(/\s+/g, ' ');
    const reason = !hasDoctype
      ? 'no <!DOCTYPE html> found anywhere in the response'
      : 'found a start but the document never closed with </html> (likely cut off)';
    throw new Error(`Not a complete HTML document (${reason}). What came back started with: "${preview}${raw.length > 140 ? '…' : ''}"`);
  }
  return html;
}

function extractCodeBlock(raw: string): string {
  let code = raw.trim();
  const fenceMatch = code.match(/```(?:js|javascript|html)?\s*([\s\S]*?)```/);
  if (fenceMatch) code = fenceMatch[1].trim();
  return code;
}

/**
 * Safety net behind the "REQUIRED for a scene that actually looks 3D" prompt
 * instructions above: an LLM can still ignore part of a long prompt (most
 * often: it writes real Three.js geometry but skips lighting, or uses
 * MeshBasicMaterial, both of which render as flat/unlit — exactly the "still
 * looks 2D" complaint even though a 3D engine was requested and technically
 * used). Checking for these markers and throwing lets the existing
 * generateWithRetry loop above retry with a fresh attempt instead of quietly
 * shipping a flat-looking "3D" game.
 */
function validateThreeJsQuality(code: string): string {
  const hasThree = /THREE\.(Scene|WebGLRenderer|PerspectiveCamera)/.test(code);
  if (!hasThree) {
    throw new Error('3D engine was requested but the generated code has no Three.js scene/renderer/camera setup.');
  }
  const hasLight = /THREE\.(AmbientLight|DirectionalLight|PointLight|SpotLight|HemisphereLight)/.test(code);
  if (!hasLight) {
    throw new Error('3D scene has no lighting (THREE.*Light) — meshes would render flat/unlit regardless of geometry.');
  }
  const hasShadedMaterial = /MeshStandardMaterial|MeshPhongMaterial|MeshLambertMaterial|MeshPhysicalMaterial/.test(code);
  const onlyBasicMaterial = /MeshBasicMaterial/.test(code) && !hasShadedMaterial;
  if (onlyBasicMaterial) {
    throw new Error('3D scene only uses MeshBasicMaterial, which ignores lighting and renders flat/2D-looking.');
  }
  return code;
}

async function generateWithRetry(
  promptBuilder: () => string,
  validator: (raw: string) => string,
  callText: TextCaller,
  logFn: LogFn,
  label: string,
  maxAttempts = 3
): Promise<string> {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) logFn(`${label} — retry ${attempt}/${maxAttempts}…`, 'warn');
      const nonce = attempt > 1
        ? `\n\n(attempt id: ${Math.random().toString(36).slice(2)} — ignore this line, it's only here to ensure a fresh response)`
        : '';
      const raw = await callText(promptBuilder() + nonce, { temperature: 0.7 });
      return validator(raw);
    } catch (err: any) {
      lastErr = err;
      logFn(`${label} attempt ${attempt} failed: ${err.message}`, 'error');
    }
  }
  throw lastErr;
}

function buildStructureAgentPrompt(opts: GameOptions): string {
  const engineNote = opts.engine === '3d'
    // ROOT CAUSE of "3D games don't work at all": this URL was missing the
    // 'r' prefix cdnjs actually uses for this release path (.../three.js/128/...
    // 404s; the real path is .../three.js/r128/...). The script tag silently
    // failed to load, so `THREE` was undefined and every line of the
    // logic agent's Three.js code threw immediately on load.
    ? `This will be a 3D game using Three.js. Include exactly this script tag in the <head>: <scr` + `ipt src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></scr` + `ipt>`
    : `This will be a 2D game using the HTML5 Canvas API — include a <canvas id="gameCanvas"></canvas> element.`;
  return `Write ONLY the HTML structure, CSS styling, and UI scaffolding (no game logic JS yet) for a simple browser game. ${engineNote}

Game concept: "${opts.concept}"

Output a complete HTML document with:
- <!DOCTYPE html>, <head> with <meta charset="UTF-8"> as its very first child (the game logic will draw emoji/unicode characters as sprites — this MUST be present and correct for those to render properly instead of as garbled text), then <style>, and <body>
- The canvas (2D) or an empty <div id="gameContainer"></div> (3D, Three.js will inject its own canvas there)
- Background/page CSS colors that thematically fit the concept above (e.g. a pond-and-lily-pad green for a frog game, a desert palette for a sand/dune game) — this is scaffolding, but the color palette must already look like it belongs to THIS concept, not a generic gray placeholder
- On-screen touch control buttons using position:fixed, anchored with pixel offsets (e.g. bottom:16px), each at least 56px square — NOT percentage-centered, so they can't be pushed off-screen
- html, body { margin:0; height:100%; overflow:hidden; touch-action:none; }
- A simple score/lives/status display positioned with fixed top offsets
- A single empty <script> tag at the very end of <body> containing only this exact comment and nothing else: // GAME_LOGIC_PLACEHOLDER

Keep the CSS concise — this is scaffolding only, the JS pass adds the actual characters/objects — but the color palette and any decorative touches must already clearly fit "${opts.concept}", not look like an unthemed generic template. Output ONLY the HTML document, starting with <!DOCTYPE html> and ending with </html>. No explanation, no markdown fences.`;
}

function buildLogicAgentPrompt(opts: GameOptions, structureHtml: string): string {
  const visualNote = opts.engine === '3d'
    ? `Every distinct entity type from the concept (player, obstacles, collectibles, enemies, etc.) must be visually distinguishable and thematically appropriate — use different mesh shapes/colors/proportions per entity type that clearly suggest what they represent (e.g. a green rounded/squashed shape for a frog, gray irregular boxes for stones), not identical plain cubes for everything.

REQUIRED for a scene that actually looks 3D (not flat/cartoonish — this is the single biggest quality issue to avoid):
- Add real lighting: at least one THREE.AmbientLight (low intensity, for fill) PLUS one THREE.DirectionalLight or THREE.PointLight (higher intensity, positioned off-axis so it casts visible shading across faces) added to the scene.
- Use THREE.MeshStandardMaterial or THREE.MeshPhongMaterial for every mesh (NOT MeshBasicMaterial, which ignores lighting entirely and renders as flat, unlit color — this alone is what makes a scene look 2D/flat even with real 3D geometry).
- Set scene.background to a THREE.Color (not left black/default) and add THREE.Fog for depth cueing on anything with distance (roads, terrain, skies).
- Position the camera with a real perspective vantage (THREE.PerspectiveCamera, FOV 50-75, positioned above/behind the action, angled downward) rather than a flat frontal/orthographic-looking view — the ground plane should visibly recede toward a horizon.
- Give the ground/floor plane visible width via THREE.PlaneGeometry (or similar) with the material rules above so it catches light and shows perspective, instead of a bare colored background.`
    : `Every distinct entity type from the concept (player, obstacles, collectibles, enemies, etc.) MUST be drawn as a large, readable emoji or Unicode symbol via ctx.font (e.g. "32px serif") + ctx.fillText at its position — pick the emoji that actually matches what the concept describes (a frog game's player should visibly be a frog emoji like 🐸, its obstacles should visibly be stones like 🪨, etc.), not a plain filled rectangle/circle. This is the single most important requirement: the concept must be immediately recognizable just by looking at the game, not just functionally implemented.`;
  const engineNote = opts.engine === '3d'
    ? 'Three.js (r128 — no OrbitControls, no CapsuleGeometry; use BoxGeometry/SphereGeometry/CylinderGeometry and manual camera control)'
    : 'the HTML5 Canvas 2D API';
  const genreNote = opts.genre ? ` Genre direction: ${opts.genre}.` : '';
  const complexityNote = opts.complexity === 'minimal'
    ? ' Keep it minimal: just the core playable loop, one win/lose condition.'
    : opts.complexity === 'rich'
      ? ' Add modest depth: simple scoring/progression and a couple of varied obstacle/enemy types, but stay realistic for one pass.'
      : ' Standard scope: a clear core loop and one simple scoring or win condition.';
  return `Here is the HTML/CSS scaffolding already built for a browser game (DO NOT repeat or rewrite this — you're only writing the JS that goes where the placeholder comment is):

\`\`\`html
${structureHtml}
\`\`\`

Game concept: "${opts.concept}" using ${engineNote}.${genreNote}${complexityNote}

VISUAL REQUIREMENT (read carefully — this is what makes the game actually match the concept instead of looking like an unthemed template): ${visualNote}

Write ONLY the JavaScript game logic that replaces the comment "// GAME_LOGIC_PLACEHOLDER" — initialize the renderer/canvas, set up keyboard (arrow keys/WASD) AND the on-screen touch buttons already present in the HTML (wire up click/touchstart listeners on their existing IDs/classes), implement the game loop, scoring, and win/lose condition described above, drawing every entity per the visual requirement above. Reference the canvas/container element already defined in the HTML above by its existing id. Assume the script runs after the DOM above has loaded (it's the last tag in <body>).

Output ONLY the raw JavaScript code — no <script> tags, no explanation, no markdown fences, just the code that goes inside the script tag.`;
}

/**
 * @param callText Text-generation function already wired to the provider fallback chain
 *                 (workflow node executors pass their own callProvider bound to a real
 *                 ProviderManager/Router; this module has no provider knowledge of its own).
 */
export async function generateGame(opts: GameOptions, logFn: LogFn, callText: TextCaller): Promise<string> {
  if (opts.iterate && opts.previousCode) {
    logFn('Applying your change request to the existing game…');
    const instruction = buildGameIteratePrompt(opts.previousCode, opts.concept);
    const iterated = await generateWithRetry(() => instruction, extractGameHtml, callText, logFn, 'Iteration');
    return injectErrorBanner(iterated);
  }

  logFn('Stage 1/2 — structure agent: building HTML/CSS scaffolding…');
  const structureHtml = await generateWithRetry(
    () => buildStructureAgentPrompt(opts),
    extractGameHtml,
    callText,
    logFn,
    'Structure agent'
  );

  if (!structureHtml.includes('GAME_LOGIC_PLACEHOLDER')) {
    logFn("Structure agent didn't include the expected placeholder — proceeding anyway, logic agent will target the last <script> tag.", 'warn');
  }

  logFn(`Stage 2/2 — logic agent: writing the ${opts.engine === '3d' ? '3D' : '2D'} game loop…`);
  const logicCode = await generateWithRetry(
    () => buildLogicAgentPrompt(opts, structureHtml),
    opts.engine === '3d'
      ? (raw: string) => validateThreeJsQuality(extractCodeBlock(raw))
      : extractCodeBlock,
    callText,
    logFn,
    'Logic agent'
  );

  const finalHtml = structureHtml.includes('GAME_LOGIC_PLACEHOLDER')
    ? structureHtml.replace('// GAME_LOGIC_PLACEHOLDER', () => logicCode)
    : structureHtml.replace(/<script>\s*<\/script>/i, () => `<script>${logicCode}</script>`);

  logFn('Assembled final game from both stages.', 'info');
  return injectErrorBanner(finalHtml);
}

/**
 * Deterministically (not LLM-dependent, so it's always present regardless of
 * what either agent produced) wires up a window.onerror handler that shows
 * a visible banner if the game's own JS throws. Without this, a script
 * error left the page as whatever bare HTML/CSS scaffolding the structure
 * agent wrote — background color, score display, touch buttons — with no
 * actual game running and no indication anything had gone wrong, which is
 * exactly what "still generating garbage" describes from the outside.
 */
function injectErrorBanner(html: string): string {
  const banner = `<script>
window.addEventListener('error', function(e) {
  var el = document.getElementById('__gameErrorBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = '__gameErrorBanner';
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#c4644a;color:#fff;font:12px/1.5 monospace;padding:10px 14px;white-space:pre-wrap;';
    document.body.appendChild(el);
  }
  el.textContent = 'Game script error: ' + (e.message || e) + (e.lineno ? (' (line ' + e.lineno + ')') : '');
});
</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => banner + '</body>') : html + banner;
}
