/**
 * Ported from the legacy monolith's parseSpreadsheetFile / computeColumnStats.
 * Relies on the SheetJS (XLSX) global loaded via CDN in index.html, exactly as
 * the monolith did — this keeps the app buildless-dependency-free rather than
 * bundling a large parser into the Vite build.
 */

declare const XLSX: any;

export interface ParsedSpreadsheet {
  headers: string[];
  rows: any[][];
  sheetName: string;
}

export interface ColumnStats {
  count: number;
  sum: number;
  avg: number;
  max: number;
  min: number;
}

export function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
  return new Promise((resolve, reject) => {
    if (typeof XLSX === 'undefined') {
      reject(new Error('XLSX (SheetJS) failed to load from CDN (network/ad-blocker issue?).'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (json.length === 0) {
          reject(new Error('Spreadsheet appears to be empty.'));
          return;
        }
        const headers = (json[0] || []).map((h: any) => String(h ?? ''));
        const rows = json.slice(1);
        resolve({ headers, rows, sheetName });
      } catch (err: any) {
        reject(new Error('Failed to parse spreadsheet: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsArrayBuffer(file);
  });
}

export function computeColumnStats(parsed: ParsedSpreadsheet, colIdx: number): ColumnStats | null {
  const vals = parsed.rows.map(r => parseFloat(r[colIdx])).filter(v => !isNaN(v));
  if (vals.length === 0) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  const avg = sum / vals.length;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  return { count: vals.length, sum, avg, max, min };
}

export function findFirstNumericColumn(parsed: ParsedSpreadsheet): number {
  for (let i = 0; i < parsed.headers.length; i++) {
    const sample = parsed.rows.slice(0, 20).map(r => parseFloat(r[i])).filter(v => !isNaN(v));
    if (sample.length > parsed.rows.slice(0, 20).length * 0.5) return i;
  }
  return -1;
}

/**
 * Lightweight all-column summary used only for grounding an AI analysis prompt
 * with real numbers (not shown directly in the UI, which uses computeColumnStats
 * against the user-picked column instead).
 */
export function computeBasicStats(parsed: ParsedSpreadsheet): Record<string, ColumnStats | null> {
  const out: Record<string, ColumnStats | null> = {};
  parsed.headers.forEach((h, i) => {
    out[h || `column_${i + 1}`] = computeColumnStats(parsed, i);
  });
  return out;
}
