/**
 * Ported from the legacy monolith's extractTextFromPDF/extractTextFromDocx/
 * extractTextFromImageOCR. Relies on pdf.js, mammoth.js and Tesseract.js loaded
 * as CDN globals in index.html, exactly as the monolith did.
 */

declare const pdfjsLib: any;
declare const mammoth: any;
declare const Tesseract: any;

export type LogFn = (message: string, level?: 'info' | 'warn' | 'error') => void;

function assertLibLoaded(lib: any, libName: string, helpUrl?: string): void {
  if (typeof lib === 'undefined' || lib === null) {
    throw new Error(`${libName} failed to load from CDN (network/ad-blocker issue?). ${helpUrl ? 'Check ' + helpUrl : ''}`);
  }
}

export async function extractTextFromPDF(arrayBuffer: ArrayBuffer, logFn?: LogFn): Promise<string> {
  assertLibLoaded(typeof pdfjsLib !== 'undefined' ? pdfjsLib : undefined, 'pdf.js');
  if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    logFn?.(`Extracting page ${i} of ${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it: any) => it.str).join(' ') + '\n\n';
  }
  if (!text.trim()) {
    throw new Error('No selectable text was found in this PDF — it may be a scanned image. Try the OCR path instead.');
  }
  return text.trim();
}

export async function extractTextFromDocx(arrayBuffer: ArrayBuffer, logFn?: LogFn): Promise<string> {
  assertLibLoaded(typeof mammoth !== 'undefined' ? mammoth : undefined, 'mammoth.js');
  logFn?.('Extracting text from .docx…');
  const result = await mammoth.extractRawText({ arrayBuffer });
  if (!result.value.trim()) throw new Error('No text could be extracted from this document.');
  return result.value.trim();
}

export async function extractTextFromImageOCR(file: File, logFn?: LogFn): Promise<string> {
  assertLibLoaded(typeof Tesseract !== 'undefined' ? Tesseract : undefined, 'Tesseract.js');
  logFn?.('Running OCR — this can take a little while…');
  const { data } = await Tesseract.recognize(file, 'eng', {
    logger: (m: any) => {
      if (m.status === 'recognizing text' && logFn) {
        logFn(`OCR: ${Math.round((m.progress || 0) * 100)}%`);
      }
    },
  });
  if (!data.text || !data.text.trim()) throw new Error('OCR found no readable text in this image.');
  return data.text.trim();
}
