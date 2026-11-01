// Landing page: the access gate (Lyzr people with Microsoft, everyone else with a work email),
// then the demo at ./app/. Also the Microsoft popup bridge, and the page's scroll motion.
import { isBridging, signIn, takeRedirectToken } from './msauth.mjs';
import { getSession, setSession, track, BOOK_DEMO_URL } from './session.mjs';

const APP = './app/';
const PERSONAL = /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|zoho|zohomail|yandex|mail|rediffmail|qq|163|126|tutanota|fastmail|hey)\.[a-z.]+$/i;

if (!isBridging()) init();

function init() {
  document.querySelectorAll('[data-book]').forEach((a) => {
    a.href = BOOK_DEMO_URL;
    a.addEventListener('click', () => track('cta', '/landing', 'Book a demo'));
  });
  document.querySelectorAll('[data-explore]').forEach((b) => b.addEventListener('click', explore));
  const gate = document.getElementById('gate');
  gate.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeGate));
  gate.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !gate.hidden) closeGate(); });
  document.getElementById('ms-signin').addEventListener('click', microsoft);
  document.getElementById('ext-form').addEventListener('submit', external);
  document.getElementById('code-form').addEventListener('submit', verifyCode);
  document.getElementById('code-resend').addEventListener('click', () => external(null, true));

  const params = new URLSearchParams(location.search);
  if (params.has('gate')) { history.replaceState(null, '', location.pathname + location.hash); openGate(); }
  // A full-page Microsoft sign-in (the fallback when the popup was blocked) comes back here.
  addEventListener('load', async () => {
    const token = await takeRedirectToken().catch(() => null);
    if (token) { openGate(); show('lyzr'); finishMicrosoft(token); }
  });
  addEventListener('load', motion);
}

function explore() {
  if (getSession()) { location.href = APP; return; }
  openGate();
}

function openGate() {
  const gate = document.getElementById('gate');
  gate.hidden = false;
  document.body.style.overflow = 'hidden';
  show('choose');
}

function closeGate() {
  document.getElementById('gate').hidden = true;
  document.body.style.overflow = '';
}

function show(id) {
  document.querySelectorAll('#gate .step').forEach((s) => { s.hidden = s.dataset.stepId !== id; });
  const step = document.querySelector(`#gate .step[data-step-id="${id}"]`);
  const first = step && step.querySelector('input, .choice, #ms-signin');
  if (first) setTimeout(() => first.focus(), 30);
}

function context() {
  const p = new URLSearchParams(location.search);
  const utm = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref']) if (p.get(k)) utm[k] = p.get(k);
  return { referrer: document.referrer || null, utm };
}

async function post(path, body, headers = {}) {
  let res;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}). Try again.`);
  return data;
}

function enter(lead) {
  setSession(lead);
  show('done');
  document.getElementById('done-title').textContent = `Welcome, ${String(lead.name || '').split(' ')[0] || 'there'}. Opening the demo…`;
  setTimeout(() => { location.href = APP; }, 900);
}

// ---- Lyzr: Microsoft ----
async function microsoft() {
  const btn = document.getElementById('ms-signin');
  const err = document.getElementById('ms-err');
  err.textContent = '';
  btn.disabled = true;
  try { await finishMicrosoft(await signIn()); }
  catch (e) { err.textContent = e.message || 'Microsoft sign-in failed.'; }
  finally { btn.disabled = false; }
}

async function finishMicrosoft(token) {
  const err = document.getElementById('ms-err');
  try {
    const r = await post('/api/ocdemo/microsoft', context(), { Authorization: 'Bearer ' + token });
    enter(r.lead);
  } catch (e) { err.textContent = e.message; }
}

// ---- outside Lyzr: work email ----
let pending = null; // { fields, challenge }

function fieldsOf(form) {
  const f = Object.fromEntries(new FormData(form).entries());
  for (const k of Object.keys(f)) f[k] = String(f[k]).trim();
  f.email = (f.email || '').toLowerCase();
  return f;
}

export function clientProblem(f) {
  if (!f.name) return ['name', 'Enter your name.'];
  if (!f.email) return ['email', 'Enter your work email.'];
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(f.email)) return ['email', 'That does not look like an email address.'];
  if (/@lyzr\.(com|ai)$/i.test(f.email)) return ['email', 'Lyzr emails sign in with Microsoft: go back and choose "I work at Lyzr".'];
  if (PERSONAL.test(f.email)) return ['email', `Use your work email: ${f.email.split('@')[1]} is a personal mail provider.`];
  if (!f.company) return ['company', 'Enter your company.'];
  return null;
}

async function external(e, resend = false) {
  if (e) e.preventDefault();
  const form = document.getElementById('ext-form');
  const err = document.getElementById(resend ? 'code-err' : 'ext-err');
  const btn = document.getElementById('ext-submit');
  form.querySelectorAll('input').forEach((i) => i.removeAttribute('aria-invalid'));
  err.textContent = '';
  const f = resend && pending ? pending.fields : fieldsOf(form);
  const problem = clientProblem(f);
  if (problem) {
    const input = form.querySelector(`[name="${problem[0]}"]`);
    input.setAttribute('aria-invalid', 'true'); input.focus();
    err.textContent = problem[1];
    return;
  }
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const r = await post('/api/ocdemo/start', { ...f, ...context() });
    if (r.step === 'code') {
      pending = { fields: f, challenge: r.challenge };
      document.getElementById('code-to').textContent = r.email;
      show('code');
      if (resend) document.getElementById('code-err').textContent = 'A new code is on its way.';
    } else enter(r.lead);
  } catch (ex) {
    err.textContent = ex.message;
    if (/email|domain|provider|address|inbox/i.test(ex.message)) form.querySelector('[name="email"]').setAttribute('aria-invalid', 'true');
  } finally { btn.disabled = false; btn.textContent = 'Continue'; }
}

async function verifyCode(e) {
  e.preventDefault();
  const err = document.getElementById('code-err');
  const code = e.target.code.value.replace(/\D/g, '');
  err.textContent = '';
  if (code.length !== 6) { err.textContent = 'Enter the 6-digit code from the email.'; return; }
  try {
    const r = await post('/api/ocdemo/verify', { ...pending.fields, ...context(), challenge: pending.challenge, code });
    enter(r.lead);
  } catch (ex) { err.textContent = ex.message; }
}

// ---- motion (GSAP + Lenis, loaded after this module; the page works without them) ----
function motion() {
  if (!window.gsap || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const { gsap } = window;
  if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);
  if (window.Lenis) {
    const lenis = new window.Lenis({ lerp: 0.1 });
    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    if (window.ScrollTrigger) lenis.on('scroll', window.ScrollTrigger.update);
    document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (ev) => {
      const t = document.querySelector(a.getAttribute('href'));
      if (t) { ev.preventDefault(); lenis.scrollTo(t, { offset: -88 }); }
    }));
  }
  if (!window.ScrollTrigger) return;
  document.querySelectorAll('[data-reveal]').forEach((el) => gsap.from(el, { y: 40, opacity: 0, duration: 0.8, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 85%' } }));
  for (const sel of ['.cards', '.hub']) {
    const box = document.querySelector(sel);
    if (box) gsap.from(box.querySelectorAll('.card, [data-step]'), { y: 40, opacity: 0, duration: 0.8, ease: 'power2.out', stagger: 0.1, scrollTrigger: { trigger: box, start: 'top 80%' } });
  }
  document.querySelectorAll('[data-count]').forEach((el) => gsap.from(el, { innerText: 0, duration: 1.6, snap: { innerText: 1 }, ease: 'power1.out', scrollTrigger: { trigger: el, start: 'top 85%' } }));
}
