/**
 * Strips Markdown syntax (headings, emphasis, code fences, links, list
 * markers, etc.) from text before it's handed to any speech/TTS provider —
 * without this, a browser or API voice reads the literal punctuation aloud
 * ("hash hash pound", "asterisk asterisk", "backtick") because Markdown is a
 * text-formatting convention, not something speech engines understand.
 *
 * This was originally written for the podcast script pipeline only; every
 * other place that turns generated text into audio (the Speech/TTS mode in
 * Audio & Music, and the Text tab's "Read Aloud" button) is a real, separate
 * code path outside that pipeline and needs the same cleanup applied to
 * whatever text it's about to speak.
 */
export function stripMarkdownForSpeech(s: string): string {
  return String(s)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/[_~]{1,2}([^_~]+)[_~]{1,2}/g, '$1')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
