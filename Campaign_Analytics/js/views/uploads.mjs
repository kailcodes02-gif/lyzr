// Upload CSVs: one drop zone for every file the dashboard takes (LinkedIn Ad Performance and
// Demographics, the other ad platforms' daily reports, Instantly campaign exports). Files are
// recognised by their columns and filed under the right channel, platform and window; a file
// uploaded twice is never counted twice. Above the box: what to export from LinkedIn and how; a
// month-by-file grid says what is in and what is missing.
import { mountUploader } from '../uploader.mjs';
import { isEditorOf } from './linkedin.mjs';
import { guideHtml, monthGrid, monthsBetween, gridHtml } from '../export-guide.mjs';
export const route = 'uploads';
export const title = 'Upload CSVs';
export const noRange = true;

const FIRST_MONTH = '2026-04';

export async function render(el, ctx) {
  const { esc } = ctx.fmt;
  const months = monthsBetween(FIRST_MONTH, ctx.fmt.today().slice(0, 7));
  el.innerHTML = `<div class="seghead">Data</div><h1>Upload CSVs</h1>
  <div class="intro">Drop every export here, any number at once, any time. Each file is read in the browser, recognised by its columns and filed where it belongs: LinkedIn Ad Performance by day and ad, LinkedIn Demographics by export window and breakdown, Google / Meta / Bing / Taboola / X daily reports under their platform, Instantly campaign exports under Email. Re-uploading a month replaces it; overlapping days overwrite; nothing is ever double counted. The grid below shows, month by month, which of the four LinkedIn files are in.</div>
  ${ctx.ui.section('LinkedIn export checklist', '', guideHtml(), 'u-guide')}
  ${ctx.ui.section('Drop files', 'All channels. The queue shows what each file was recognised as before you press Upload all.', '<div id="uploader"></div>', 'u-drop')}
  ${ctx.ui.section('What is in, month by month', `LinkedIn, ${esc(ctx.fmt.monthLabel(FIRST_MONTH))} to today. A tick means the whole month is covered; a count means part of it; missing means nothing yet. Hover a cell for the dates. Instantly, HubSpot and the other platforms are listed under Admin › Data coverage.`, `<div id="grid">${ctx.ui.spinner('Reading uploads')}</div>`, 'u-grid')}`;
  const drawGrid = async () => {
    const box = el.querySelector('#grid'); if (!box) return;
    try { const { uploads } = await ctx.api.get('uploads', {}); box.innerHTML = gridHtml(monthGrid(uploads || [], months)); }
    catch (e) { box.innerHTML = ctx.ui.empty('Uploads could not be read: ' + (e.message || e)); }
  };
  mountUploader(el.querySelector('#uploader'), ctx, { channel: 'all', isEditor: isEditorOf(ctx), onDone: drawGrid });
  await drawGrid();
}
