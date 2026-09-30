// Bulk upload: read any dropped file (CSV, TSV, TXT, XLSX, XLS) and work out what it is and where it goes.
//   detectFile(file) -> { id, file, channel:'linkedin'|'email', platform?, kind:'performance'|'demographics'|'events', parsed, label, needs:[...] }
//   platform is the ad platform for channel 'linkedin' rows: linkedin, google, meta, bing, taboola, x or chatgpt.
//   or throws with a readable reason. Excel files are converted to CSV with SheetJS (loaded on first use).
import { parseLinkedInCsv, decodeCsvBuffer, parseRows, detectDelimiter } from './csv.mjs';
import { parseInstantlyCsv, isInstantlyHeader, campaignLabel } from './email-csv.mjs';
import { parseAdsCsv, PLATFORM_LABEL } from './ads-csv.mjs';

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let xlsxLoading = null;
function loadXlsx() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  if (!xlsxLoading) xlsxLoading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = XLSX_URL; s.onload = () => res(globalThis.XLSX); s.onerror = () => rej(new Error('Could not load the Excel reader')); document.head.appendChild(s); });
  return xlsxLoading;
}

/** File -> text. Excel: the first sheet with data, as CSV. */
export async function readText(file) {
  const buf = await file.arrayBuffer();
  if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    for (const name of wb.SheetNames) { const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false }); if (csv.trim()) return csv; }
    throw new Error('The workbook has no data.');
  }
  return decodeCsvBuffer(buf);
}

/** Text + file name -> detected upload. Pure, so node tests can call it. */
export function detectText(text, fileName) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) throw new Error('The file is empty.');
  // Instantly: the header is the first line.
  const head = parseRows(lines[0], detectDelimiter(lines[0]))[0] || [];
  if (isInstantlyHeader(head)) {
    const parsed = parseInstantlyCsv(text, fileName);
    return { channel: 'email', kind: 'events', parsed, label: `Email · ${campaignLabel(parsed.campaign)}`, needs: parsed.campaign ? [] : ['campaign'] };
  }
  // Other ad platforms (Google Ads, Meta, Bing, Taboola, X, ChatGPT): recognised from their
  // header row or the file name; anything else falls through to the LinkedIn parser.
  let ads = null;
  try { ads = parseAdsCsv(text, fileName); } catch { ads = null; }
  if (ads && ads.rows.length) return { channel: 'linkedin', platform: ads.platform, kind: 'performance', parsed: ads, label: `Ads · ${PLATFORM_LABEL[ads.platform] || ads.platform}`, needs: [] };
  const NOT = 'Not recognised: expected an Instantly campaign export, a LinkedIn Campaign Manager export (ad performance or demographics), or a daily campaign export from Google Ads, Meta, Bing, Taboola or X.';
  let parsed;
  try { parsed = parseLinkedInCsv(text, fileName); } catch (e) { throw new Error(`${NOT} (${e.message})`); }
  const known = Object.values(parsed.columns || {}).filter(f => !String(f).startsWith('extra:')).length;
  if (known < 3 || !parsed.rows.length) throw new Error(NOT);
  const needs = parsed.kind === 'demographics' && (!parsed.period_start || !parsed.period_end) ? ['window'] : [];
  return { channel: 'linkedin', platform: 'linkedin', kind: parsed.kind, parsed, label: parsed.kind === 'performance' ? 'Ads · LinkedIn performance' : 'Ads · LinkedIn demographics', needs };
}

export async function detectFile(file) {
  const text = await readText(file);
  return { id: Math.random().toString(36).slice(2), file: file.name, size: file.size, ...detectText(text, file.name), status: '', progress: '' };
}
