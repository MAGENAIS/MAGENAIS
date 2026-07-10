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
    ? `This will be a 3D game using Three.js. Include exactly this script tag in the <head>: <scr` + `ipt src="https://cdnjs.cloudflare.com/ajax/libs/three.js/128/three.min.js"></scr` + `ipt>`
    : `This will be a 2D game using the HTML5 Canvas API — include a <canvas id="gameCanvas"></canvas> element.`;
  return `Write ONLY the HTML structure, CSS styling, and UI scaffolding (no game logic JS yet) for a simple browser game. ${engineNote}

Game concept: "${opts.concept}"

Output a complete HTML document with:
- <!DOCTYPE html>, <head> with <style>, and <body>
- The canvas (2D) or an empty <div id="gameContainer"></div> (3D, Three.js will inject its own canvas there)
- On-screen touch control buttons using position:fixed, anchored with pixel offsets (e.g. bottom:16px), each at least 56px square — NOT percentage-centered, so they can't be pushed off-screen
- html, body { margin:0; height:100%; overflow:hidden; touch-action:none; }
- A simple score/lives/status display positioned with fixed top offsets
- A single empty <script> tag at the very end of <body> containing only this exact comment and nothing else: // GAME_LOGIC_PLACEHOLDER

Keep CSS concise — this is scaffolding only, not the final styled product. Output ONLY the HTML document, starting with <!DOCTYPE html> and ending with </html>. No explanation, no markdown fences.`;
}

function buildLogicAgentPrompt(opts: GameOptions, structureHtml: string): string {
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

Write ONLY the JavaScript game logic that replaces the comment "// GAME_LOGIC_PLACEHOLDER" — initialize the renderer/canvas, set up keyboard (arrow keys/WASD) AND the on-screen touch buttons already present in the HTML (wire up click/touchstart listeners on their existing IDs/classes), implement the game loop, scoring, and win/lose condition described above. Reference the canvas/container element already defined in the HTML above by its existing id. Assume the script runs after the DOM above has loaded (it's the last tag in <body>).

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
    return generateWithRetry(() => instruction, extractGameHtml, callText, logFn, 'Iteration');
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
    extractCodeBlock,
    callText,
    logFn,
    'Logic agent'
  );

  const finalHtml = structureHtml.includes('GAME_LOGIC_PLACEHOLDER')
    ? structureHtml.replace('// GAME_LOGIC_PLACEHOLDER', logicCode)
    : structureHtml.replace(/<script>\s*<\/script>/i, `<script>${logicCode}</script>`);

  logFn('Assembled final game from both stages.', 'info');
  return finalHtml;
}
