import { Kernel } from '../core/Kernel';

declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

/**
 * Wires a mic button to voice input: browser SpeechRecognition (free, instant,
 * no network round-trip) when available, otherwise records audio and runs it
 * through the normal 'audio' (speech-to-text) provider fallback chain — which
 * is more resilient than the legacy monolith's Hugging-Face-only Whisper
 * fallback, since it will try every enabled/keyed transcription provider in
 * priority order, not just one.
 */
export function wireMicButton(
  kernel: Kernel,
  micBtn: HTMLElement,
  statusEl: HTMLElement | null,
  onTranscript: (text: string) => void
): void {
  let isRecording = false;
  let recognizer: any = null;
  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];

  const setStatus = (text: string) => {
    if (statusEl) statusEl.textContent = text;
  };

  const stopRecording = () => {
    if (recognizer) recognizer.stop();
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    isRecording = false;
    micBtn.classList.remove('recording');
  };

  const recordAndTranscribe = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setStatus('Transcribing…');
        try {
          const blob = new Blob(audioChunks, { type: 'audio/webm' });
          const text = await kernel
            .getProviderManager()
            .callWithFallback('audio', kernel.getRouter(), { blob }, {}, undefined);
          onTranscript(text);
          setStatus('Captured via speech-to-text provider.');
        } catch (err: any) {
          setStatus('Transcription failed — ' + err.message);
        }
      };
      mediaRecorder.start();
      isRecording = true;
      micBtn.classList.add('recording');
      setStatus('Recording… click the mic again to stop.');
    } catch (err: any) {
      setStatus("Couldn't access the microphone — " + err.message);
    }
  };

  micBtn.addEventListener('click', async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      isRecording = true;
      micBtn.classList.add('recording');
      setStatus('Listening… speak now.');
      recognizer = new SR();
      recognizer.lang = 'en-US';
      recognizer.interimResults = false;
      recognizer.maxAlternatives = 1;
      recognizer.onresult = (event: any) => {
        onTranscript(event.results[0][0].transcript);
        setStatus('Captured via browser speech recognition.');
        isRecording = false;
        micBtn.classList.remove('recording');
      };
      recognizer.onerror = async (event: any) => {
        setStatus(`Browser recognition failed (${event.error || 'error'}) — trying a speech-to-text provider…`);
        isRecording = false;
        micBtn.classList.remove('recording');
        const hasAudioProvider = kernel.getProviderManager().getProviders('audio', true).some((p: any) => p.noKeyNeeded || !!p.apiKey);
        if (hasAudioProvider) {
          await recordAndTranscribe();
        } else {
          setStatus('Voice input unavailable — add an audio/transcription provider key in Keys & Providers, or type your prompt.');
        }
      };
      recognizer.start();
    } else {
      const hasAudioProvider = kernel.getProviderManager().getProviders('audio', true).some((p: any) => p.noKeyNeeded || !!p.apiKey);
      if (hasAudioProvider) {
        await recordAndTranscribe();
      } else {
        setStatus("Speech recognition isn't supported in this browser, and no transcription provider is configured.");
      }
    }
  });
}
