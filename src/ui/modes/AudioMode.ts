import { Mode } from './Mode';

export class AudioMode extends Mode {
  private activeMode: 'speech' | 'music' | 'podcast' = 'speech';

  activate(): void {
    this.renderControl(`
      <div class="field">
        <label class="field-label">Mode</label>
        <div class="chip-group" id="audioModeChips">
          <span class="chip active" data-val="speech">Speech (Text-to-Speech)</span>
          <span class="chip" data-val="music">Music generation</span>
          <span class="chip" data-val="podcast">Podcast</span>
        </div>
      </div>
      <div class="field" id="audioPromptField">
        <label class="field-label">Text to speak</label>
        <textarea id="promptInput" rows="5" placeholder="Welcome to MAGENAIS..."></textarea>
      </div>
      <div class="field" id="audioVoiceField">
        <label class="field-label">Voice</label>
        <select id="audioVoice">
          <option value="nova">nova</option>
          <option value="alloy">alloy</option>
          <option value="echo">echo</option>
          <option value="fable">fable</option>
          <option value="onyx">onyx</option>
          <option value="shimmer">shimmer</option>
          <option value="rachel">rachel (ElevenLabs)</option>
          <option value="adam">adam (ElevenLabs)</option>
          <option value="bella">bella (ElevenLabs)</option>
        </select>
      </div>
      <div class="field" id="audioStyleField" style="display:none;">
        <label class="field-label">Style / genre tags</label>
        <input type="text" id="musicStyle" placeholder="e.g. lo-fi chillhop, ambient piano">
      </div>
      <div class="field" id="audioDurField" style="display:none;">
        <label class="field-label">Duration (seconds, music only)</label>
        <div class="slider-row">
          <input type="range" id="audioDuration" min="10" max="180" step="10" value="60">
          <span class="slider-val" id="audioDurationVal">60s</span>
        </div>
      </div>
      <div class="field" id="podcastFields" style="display:none;">
        <label class="field-label">Format</label>
        <div class="chip-group" id="podcastFormatChips">
          <span class="chip active" data-val="solo">Single narrator</span>
          <span class="chip" data-val="dialogue">Two-host dialogue</span>
        </div>
      </div>
      <div class="field" id="podcastSourceField" style="display:none;">
        <label class="field-label">Script source</label>
        <div class="chip-group" id="podcastSourceChips">
          <span class="chip active" data-val="generate">Generate script from a topic</span>
          <span class="chip" data-val="paste">I'll paste my own script</span>
        </div>
      </div>
      <div class="field" id="podcastPasteHint" style="display:none;">
        <p class="hint">For dialogue, prefix each line with <code>Host A:</code> or <code>Host B:</code>.</p>
      </div>
      <div class="field" id="podcastLengthField">
        <label class="field-label">Target length</label>
        <div class="chip-group" id="podcastLengthChips">
          <span class="chip" data-val="short">Short (~1 min)</span>
          <span class="chip active" data-val="medium">Medium (~3 min)</span>
          <span class="chip" data-val="long">Long (~6 min)</span>
        </div>
      </div>
      <div class="field" id="podcastVoiceA">
        <label class="field-label" id="podcastVoiceALabel">Narrator voice</label>
        <select id="podcastVoiceASelect">
          <option value="nova">nova</option>
          <option value="alloy">alloy</option>
          <option value="echo">echo</option>
          <option value="fable">fable</option>
          <option value="onyx">onyx</option>
          <option value="shimmer">shimmer</option>
        </select>
      </div>
      <div class="field" id="podcastVoiceB" style="display:none;">
        <label class="field-label">Host B voice</label>
        <select id="podcastVoiceBSelect">
          <option value="onyx">onyx</option>
          <option value="echo">echo</option>
          <option value="alloy">alloy</option>
          <option value="nova">nova</option>
          <option value="fable">fable</option>
          <option value="shimmer">shimmer</option>
        </select>
      </div>
      <div id="audioKeyWarning"></div>
      <p class="hint" id="audioPipelineHint">Pipeline: gen.pollinations.ai TTS → browser speech fallback</p>
      <button class="run-btn" id="runBtn">▸ Generate Audio</button>
    `);

    this.wireModeChips();
    this.wireSubChips();

    // Duration slider
    const durSlider = document.getElementById('audioDuration') as HTMLInputElement;
    const durVal = document.getElementById('audioDurationVal') as HTMLElement;
    durSlider?.addEventListener('input', () => { if (durVal) durVal.textContent = durSlider.value + 's'; });

    document.getElementById('runBtn')?.addEventListener('click', () => this.runGuarded('runBtn', () => this.handleGenerate()));
  }

  private wireModeChips(): void {
    document.querySelectorAll('#audioModeChips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#audioModeChips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.activeMode = (chip as HTMLElement).dataset.val as any;
        this.updateVisibility();
      });
    });
    this.updateVisibility();
  }

  private updateVisibility(): void {
    const isMusic = this.activeMode === 'music';
    const isPodcast = this.activeMode === 'podcast';
    document.getElementById('audioStyleField')!.style.display = isMusic ? '' : 'none';
    document.getElementById('audioDurField')!.style.display = isMusic ? '' : 'none';
    document.getElementById('audioVoiceField')!.style.display = (isMusic || isPodcast) ? 'none' : '';
    document.getElementById('podcastFields')!.style.display = isPodcast ? '' : 'none';
    document.getElementById('podcastSourceField')!.style.display = isPodcast ? '' : 'none';
    document.getElementById('podcastVoiceA')!.style.display = isPodcast ? '' : 'none';
    if (!isPodcast) {
      document.getElementById('podcastVoiceB')!.style.display = 'none';
      document.getElementById('podcastPasteHint')!.style.display = 'none';
    }
    // Update prompt placeholder
    const prompt = document.getElementById('promptInput') as HTMLTextAreaElement;
    if (isMusic) prompt.placeholder = 'e.g. An uplifting cinematic orchestral piece...';
    else if (isPodcast) prompt.placeholder = 'Enter a topic for the podcast.';
    else prompt.placeholder = 'Welcome to MAGENAIS...';
    // Update button text
    const btn = document.getElementById('runBtn');
    if (btn) btn.textContent = isMusic ? '▸ Generate Music' : isPodcast ? '▸ Generate Podcast' : '▸ Generate Speech';
    // Update hint
    const hint = document.getElementById('audioPipelineHint');
    if (hint) {
      hint.innerHTML = isMusic
        ? 'Pipeline: gen.pollinations.ai ElevenMusic → Hugging Face MusicGen'
        : isPodcast
        ? 'Pipeline: script generation → TTS per line → stitched WAV'
        : 'Pipeline: gen.pollinations.ai TTS → browser speech fallback';
    }
    // Also update podcast sub-fields when switching to podcast
    if (isPodcast) this.updatePodcastSubFields();
  }

  private wireSubChips(): void {
    // Podcast sub-chips
    document.querySelectorAll('#podcastFormatChips .chip, #podcastSourceChips .chip, #podcastLengthChips .chip')
      .forEach(chip => {
        chip.addEventListener('click', () => {
          const parent = chip.closest('.chip-group') as HTMLElement;
          parent.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          if (parent.id === 'podcastFormatChips' || parent.id === 'podcastSourceChips') {
            this.updatePodcastSubFields();
          }
        });
      });
  }

  private updatePodcastSubFields(): void {
    const formatChip = document.querySelector('#podcastFormatChips .chip.active') as HTMLElement;
    const isDialogue = formatChip?.dataset.val === 'dialogue';
    document.getElementById('podcastVoiceB')!.style.display = isDialogue ? '' : 'none';
    document.getElementById('podcastVoiceALabel')!.textContent = isDialogue ? 'Host A voice' : 'Narrator voice';
    const sourceChip = document.querySelector('#podcastSourceChips .chip.active') as HTMLElement;
    const source = sourceChip?.dataset.val || 'generate';
    document.getElementById('podcastPasteHint')!.style.display = (source === 'paste' && isDialogue) ? '' : 'none';
    document.getElementById('podcastLengthField')!.style.display = source === 'generate' ? '' : 'none';
    const prompt = document.getElementById('promptInput') as HTMLTextAreaElement;
    if (source === 'generate') {
      prompt.placeholder = 'e.g. The history and future of solid-state batteries';
    } else {
      prompt.placeholder = isDialogue
        ? 'Host A: Welcome back!\nHost B: Thanks for having me...'
        : 'Paste your full narration script here.';
    }
  }

  private async handleGenerate(): Promise<void> {
    const prompt = (document.getElementById('promptInput') as HTMLTextAreaElement)?.value.trim();
    if (!prompt) { alert('Enter text/topic.'); return; }

    // Build workflow based on active mode
    let workflow;
    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) stage.innerHTML = '<div class="spinner"></div><div class="empty-text">Generating audio...</div>';

    try {
      if (this.activeMode === 'speech') {
        const voice = (document.getElementById('audioVoice') as HTMLSelectElement)?.value || 'nova';
        workflow = {
          id: 'sp-' + Date.now(),
          name: 'Speech Generation',
          graph: {
            nodes: [{
              id: 'speech1',
              type: 'speech' as const,
              label: 'TTS',
              config: { voice },
              inputs: { text: prompt },
              enabled: true,
            }],
            edges: [],
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const result = await this.kernel.getWorkflowEngine().execute(workflow, { text: prompt });
        const url = result.finalOutput;
        if (stage) {
          if (url === '__BROWSER_TTS_PLAYED__') {
            stage.innerHTML = `<div class="result-text">${prompt}</div>`;
            this.appendLog("Played live via your browser's built-in voice — no downloadable file. Add a keyed speech provider in Keys & Providers to get one.", 'warn');
          } else {
            // Text shown first, player (no autoplay, explicit play/pause/stop) after —
            // see Mode.renderAudioBlock for why this doesn't autoplay.
            stage.innerHTML = `
              <div class="result-text" style="margin-bottom:14px;">${prompt}</div>
              ${this.renderAudioBlock(url, { filename: 'magen-audio', downloadLabel: 'Download Audio' })}`;
            this.wireAudioControls(stage);
          }
        }
        if (url !== '__BROWSER_TTS_PLAYED__') {
          this.kernel.getStore().getActions().addHistoryEntry({
            mode: 'speech', prompt, result: url, resultType: 'audio',
          });
        }
      } else if (this.activeMode === 'music') {
        const style = (document.getElementById('musicStyle') as HTMLInputElement)?.value.trim();
        const duration = parseInt((document.getElementById('audioDuration') as HTMLInputElement)?.value || '60');
        workflow = {
          id: 'mu-' + Date.now(),
          name: 'Music Generation',
          graph: {
            nodes: [{
              id: 'music1',
              type: 'music' as const,
              label: 'Music Gen',
              config: { style, duration },
              inputs: { prompt },
              enabled: true,
            }],
            edges: [],
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const result = await this.kernel.getWorkflowEngine().execute(workflow, { prompt });
        const url = result.finalOutput;
        if (stage) {
          stage.innerHTML = this.renderAudioBlock(url, { filename: 'magen-music', downloadLabel: 'Download Audio' });
          this.wireAudioControls(stage);
        }
        this.kernel.getStore().getActions().addHistoryEntry({
          mode: 'music', prompt, result: url, resultType: 'audio',
        });
      } else if (this.activeMode === 'podcast') {
        const { generatePodcast } = await import('../../workflows/legacy/podcast');
        const formatChip = document.querySelector('#podcastFormatChips .chip.active') as HTMLElement;
        const sourceChip = document.querySelector('#podcastSourceChips .chip.active') as HTMLElement;
        const lengthChip = document.querySelector('#podcastLengthChips .chip.active') as HTMLElement;
        const isDialogue = formatChip?.dataset.val === 'dialogue';
        const source = (sourceChip?.dataset.val || 'generate') as 'generate' | 'script';
        const lengthTarget = (lengthChip?.dataset.val || 'medium') as 'short' | 'medium' | 'long';
        const voiceA = (document.getElementById('podcastVoiceASelect') as HTMLSelectElement)?.value || 'nova';
        const voiceB = (document.getElementById('podcastVoiceBSelect') as HTMLSelectElement)?.value || 'onyx';
        const podcastOpts = {
          source, isDialogue, lengthTarget,
          topic: prompt, script: prompt,
          voiceA, voiceB,
        };
        const result = await generatePodcast(
          podcastOpts,
          (msg: string) => console.log(msg),
          this.kernel.getProviderManager(),
          this.kernel.getRouter()
        );
        if (stage) {
          const audioBlock = result.url
            ? this.renderAudioBlock(result.url, { filename: 'magen-podcast.wav', downloadLabel: 'Download Podcast (.wav)' })
            : '';
          if (!result.url) {
            this.appendLog(
              'No downloadable audio file — no enabled, keyed speech provider succeeded (the script below was ' +
              "spoken aloud using your browser's built-in voice as a preview only, which can't be saved to a file). " +
              'Add an API key for at least one speech provider in Keys & Providers to get a downloadable .wav.',
              'warn'
            );
          }
          // Script shown first (readable immediately), player after it — see
          // Mode.renderAudioBlock for why playback doesn't start automatically.
          stage.innerHTML = `
            <p class="field-label">Script (${result.lineCount} lines)</p>
            <div class="doc-summary-block" style="margin-bottom:18px;"><div class="result-text">${result.script}</div></div>
            <div class="result-actions" style="margin-bottom:${result.url ? '18px' : '0'};">
              <button class="ghost-btn" id="copyPodcastScriptBtn">Copy script</button>
            </div>
            ${audioBlock}`;
          document.getElementById('copyPodcastScriptBtn')?.addEventListener('click', () => {
            navigator.clipboard.writeText(result.script);
          });
          this.wireAudioControls(stage);
        }
        this.kernel.getStore().getActions().addHistoryEntry({
          mode: 'podcast', prompt, result: result.url || result.script, resultType: result.url ? 'audio' : 'text',
        });
      }
    } catch (err: any) {
      this.renderError(err);
    }
  }

  deactivate(): void {}
  getTitle(): string { return 'Audio / Music Output'; }
}
