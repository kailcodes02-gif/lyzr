// Page tidy-up that every view gets for free (mounted once by app.mjs):
//  1. Long explanations stay out of the way: a section's or page's `.sub` paragraph longer than a short line
//     shows only its first sentence (when short) plus a "How to read this" toggle; the full text, links and
//     element ids stay in the DOM, so code that updates them keeps working. Controls inside the text (the
//     per-section Compare selector, buttons, inputs) are moved to a toolbar row so they stay visible.
//  2. Long `.intro` boxes collapse to their first sentence with a "More" toggle.
//  3. Press feedback: a short vibration on phones that support it (Android), on top of the CSS press state.
const LONG = 110;
const firstSentence = t => (String(t).trim().match(/^.*?[.!?](?=\s|$)/) || [String(t).trim()])[0];

function tidySub(p) {
  if (p.dataset.tidy) return; p.dataset.tidy = '1';
  // Controls: top-level ones only (a select inside a .cmpbox moves with its box).
  const controls = [...p.querySelectorAll('.cmpbox, select, input, button, .btn')].filter(el => el.classList.contains('cmpbox') || !el.closest('.cmpbox'));
  let tools = null;
  if (controls.length) { tools = document.createElement('div'); tools.className = 'sec-tools'; for (const c of controls) tools.appendChild(c); }
  const text = p.textContent.replace(/\s+/g, ' ').trim();
  if (text.length <= LONG) { if (tools) p.after(tools); if (!text) p.hidden = true; return; }
  const lead = firstSentence(text);
  const wrap = document.createElement('div'); wrap.className = 'subwrap';
  const leadEl = document.createElement('span'); leadEl.className = 'sublead'; leadEl.textContent = lead.length <= LONG ? lead : '';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'infobtn'; btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span aria-hidden="true">i</span>How to read this';
  wrap.append(leadEl, btn);
  p.before(wrap); p.classList.add('sub-more'); p.hidden = true;
  if (tools) wrap.after(tools);
  btn.onclick = () => { const open = p.hidden; p.hidden = !open; leadEl.hidden = open; btn.setAttribute('aria-expanded', String(open)); btn.lastChild.textContent = open ? 'Hide' : 'How to read this'; };
}

function tidyIntro(box) {
  if (box.dataset.tidy) return; box.dataset.tidy = '1';
  const text = box.textContent.replace(/\s+/g, ' ').trim();
  if (text.length <= 220 || box.querySelector('input, select, button, .drop')) return;
  const lead = firstSentence(text);
  const full = document.createElement('div'); full.className = 'intro-full'; full.hidden = true;
  while (box.firstChild) full.appendChild(box.firstChild);
  const leadEl = document.createElement('span'); leadEl.textContent = lead.length <= 200 ? lead + ' ' : '';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'infobtn'; btn.innerHTML = '<span aria-hidden="true">i</span>More';
  btn.setAttribute('aria-expanded', 'false');
  box.append(leadEl, btn, full);
  btn.onclick = () => { const open = full.hidden; full.hidden = !open; leadEl.hidden = open; btn.setAttribute('aria-expanded', String(open)); btn.lastChild.textContent = open ? 'Less' : 'More'; };
}

export function mountTidy(root) {
  const run = () => {
    root.querySelectorAll('.sub:not([data-tidy])').forEach(tidySub);
    root.querySelectorAll('.intro:not([data-tidy])').forEach(tidyIntro);
  };
  run();
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; run(); }); }).observe(root, { childList: true, subtree: true });
  // Haptics: a 8 ms tick on press, where the browser supports it.
  document.addEventListener('pointerdown', e => {
    const t = e.target.closest && e.target.closest('button:not(:disabled), .btn, summary, .chip, .pm-chip, a.pick, [role="tab"]');
    if (t && navigator.vibrate) { try { navigator.vibrate(8); } catch { /* not allowed */ } }
  }, { passive: true });
}
