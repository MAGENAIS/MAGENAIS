import { ProviderManager } from '../../providers/registry/Manager';
import { SmartRouter } from '../../providers/Router';
import { stripMarkdownForSpeech } from '../../core/textUtils';

// Re-exported so existing imports of this module keep working unchanged.
export { stripMarkdownForSpeech } from '../../core/textUtils';

export type LogFn = (message: string, level?: 'info' | 'warn' | 'error') => void;

export interface PodcastOptions {
  source: 'generate' | 'script';
  isDialogue: boolean;
  lengthTarget: 'short' | 'medium' | 'long';
  topic: string;
  script: string;
  voiceA: string;
  voiceB: string;
}

export interface PodcastResult {
  url: string | null;
  script: string;
  lineCount: number;
  skippedLiveOnlyCount: number;
}

interface ScriptLine {
  speaker: 'A' | 'B';
  text: string;
}



function chunkTextForSpeech(text: string, maxLen: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length > maxLen && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = (current + ' ' + sentence).trim();
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

function parsePodcastScript(script: string, isDialogue: boolean): ScriptLine[] {
  const rawLines = script.split('\n').map(l => l.trim()).filter(Boolean);
  if (!isDialogue) {
    return chunkTextForSpeech(script.replace(/\n+/g, ' ').trim(), 400).map(text => ({ speaker: 'A' as const, text }));
  }
  const turns: ScriptLine[] = [];
  const speakerPattern = /^([A-Za-z0-9 _-]{1,20}):\s*(.+)$/;
  let lastSpeaker: 'A' | 'B' = 'A';
  for (const line of rawLines) {
    const m = line.match(speakerPattern);
    if (m) {
      const label = m[1].trim().toLowerCase();
      const speaker: 'A' | 'B' = label.includes('b') || label.includes('2') ? 'B' : 'A';
      lastSpeaker = speaker;
      turns.push({ speaker, text: m[2].trim() });
    } else {
      turns.push({ speaker: lastSpeaker, text: line });
    }
  }
  return turns.length ? turns : [{ speaker: 'A', text: script }];
}

async function generatePodcastScript(
  topic: string,
  isDialogue: boolean,
  lengthTarget: string,
  providerManager: ProviderManager,
  router: SmartRouter,
  log?: LogFn
): Promise<string> {
  const wordTarget = lengthTarget === 'short' ? '150-200' : lengthTarget === 'long' ? '800-1000' : '350-450';
  const instruction = isDialogue
    ? `Write a natural, engaging two-host podcast dialogue (about ${wordTarget} words total) on this topic: "${topic}". Format every line as "Host A: ..." or "Host B: ..." on its own line, alternating naturally as a real conversation would — questions, reactions, back-and-forth, not just alternating monologues. Open with a brief welcome and close with a short sign-off. Do not include sound effect cues, music notes, or stage directions — only spoken dialogue.`
    : `Write an engaging single-narrator podcast script (about ${wordTarget} words) on this topic: "${topic}". Write it as natural spoken narration in flowing paragraphs — no headers, no bullet points, no stage directions, just the words a narrator would actually say aloud.`;
  log?.(`Writing podcast script (${isDialogue ? 'two-host dialogue' : 'solo narration'}, ~${wordTarget} words)…`);
  return providerManager.callWithFallback('text', router, { prompt: instruction }, { temperature: 0.8 }, log);
}

async function voicePodcastLine(
  text: string,
  voice: string,
  providerManager: ProviderManager,
  router: SmartRouter,
  log?: LogFn
): Promise<{ url: string | null; recordable: boolean; fallbackText?: string }> {
  const cleanText = stripMarkdownForSpeech(text);
  try {
    const url = await providerManager.callWithFallback('speech', router, { prompt: cleanText }, { voice }, log);
    if (typeof url === 'string' && url !== '__BROWSER_TTS_PENDING__') {
      return { url, recordable: true };
    }
    // The only provider that succeeded was the browser-speech fallback, which
    // has no capture API — nothing has been spoken yet (see
    // BrowserSpeechAdapter), so there's nothing to record.
    return { url: null, recordable: false, fallbackText: cleanText };
  } catch (err: any) {
    log?.(`All speech providers failed for this line — ${err.message}`, 'warn');
    return { url: null, recordable: false, fallbackText: cleanText };
  }
}

function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const bufferSize = 44 + dataSize;
  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) channelData.push(buffer.getChannelData(ch));
  let pos = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      pos += 2;
    }
  }
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

async function stitchAudioClips(blobUrls: string[], log?: LogFn): Promise<Blob> {
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) throw new Error("Web Audio API not available in this browser — can't stitch clips into one file.");
  const ctx = new AudioCtx();
  const gapSeconds = 0.35;
  const buffers: AudioBuffer[] = [];
  for (let i = 0; i < blobUrls.length; i++) {
    log?.(`Decoding clip ${i + 1} of ${blobUrls.length}…`);
    const res = await fetch(blobUrls[i]);
    const arrayBuffer = await res.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    buffers.push(decoded);
  }
  const sampleRate = buffers[0].sampleRate;
  const numChannels = Math.max(...buffers.map(b => b.numberOfChannels));
  const gapSamples = Math.floor(gapSeconds * sampleRate);
  const totalSamples = buffers.reduce((sum, b) => sum + b.length, 0) + gapSamples * (buffers.length - 1);

  const output = ctx.createBuffer(numChannels, totalSamples, sampleRate);
  let offset = 0;
  for (const buf of buffers) {
    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = ch < buf.numberOfChannels ? buf.getChannelData(ch) : buf.getChannelData(0);
      output.getChannelData(ch).set(channelData, offset);
    }
    offset += buf.length + gapSamples;
  }
  await ctx.close();
  return audioBufferToWavBlob(output);
}

export async function generatePodcast(
  opts: PodcastOptions,
  log: LogFn,
  providerManager: ProviderManager,
  router: SmartRouter
): Promise<PodcastResult> {
  let script = opts.script;
  if (opts.source === 'generate') {
    script = await generatePodcastScript(opts.topic, opts.isDialogue, opts.lengthTarget, providerManager, router, log);
  }
  const lines = parsePodcastScript(script, opts.isDialogue);
  if (lines.length === 0) throw new Error("Couldn't find any spoken lines in this script.");
  log(`Voicing ${lines.length} line(s)${opts.isDialogue ? ' across 2 speakers' : ''}…`);

  const recordableUrls: string[] = [];
  let skippedLiveOnlyCount = 0;
  for (const line of lines) {
    const voice = line.speaker === 'B' ? opts.voiceB : opts.voiceA;
    const result = await voicePodcastLine(line.text, voice, providerManager, router, log);
    if (result.recordable && result.url) {
      recordableUrls.push(result.url);
    } else {
      skippedLiveOnlyCount++;
    }
  }

  if (recordableUrls.length === 0) {
    // ROOT CAUSE (reported: "podcast plays system sound then stops, no
    // downloadable file, and no text shown"): the browser-speech fallback
    // DOES speak each line aloud as an interactive preview (that's the
    // "system sound" the user hears) — it just can't produce a
    // downloadable audio blob, because speechSynthesis has no capture API.
    // Throwing here discarded the perfectly good generated `script` along
    // with the audio, so the user was left with nothing but a bare error
    // even though real, usable text had already been produced (and paid
    // for, if a text provider was used). Return it instead of throwing, so
    // the UI can still show the script and explain why there's no file.
    log(
      'No lines could be recorded into a downloadable file — no enabled, keyed speech provider succeeded. ' +
      'Showing the generated script; add an API key for at least one speech provider in Keys & Providers to get a downloadable podcast.',
      'warn'
    );
    return { url: null, script, lineCount: lines.length, skippedLiveOnlyCount };
  }

  log(`Stitching ${recordableUrls.length} clip(s) into one file…`);
  const wavBlob = await stitchAudioClips(recordableUrls, log);
  const url = URL.createObjectURL(wavBlob);
  return { url, script, lineCount: lines.length, skippedLiveOnlyCount };
}
