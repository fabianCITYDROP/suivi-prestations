// The team app reads only the last 40 days, open requests and the year's tailgate controls at opening; older ones arrive when a page asks for them.
// Run from tests-regles/ after `npm install`: npm run chargement (local emulators only, Playwright must be installed).
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = process.argv[2] || path.join(__dirname, '..');
const FS = 'http://127.0.0.1:8080/v1/projects/suivi-prestations/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : typeof v === 'number' ? { doubleValue: v } : typeof v === 'string' ? { stringValue: v }
  : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: val(obj).mapValue.fields }) }).then(r => { if (!r.ok) throw new Error(p + ' ' + r.status); });
const del = (p) => fetch(`${FS}/${p}`, { method: 'DELETE', headers: owner });
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then(r => r.json());
const ok = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' ' + label); if (!cond) process.exitCode = 1; };
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

(async () => {
  const base = { prestataire: 'ALLO pare-brise 78', prestataireId: 'allo-pare-brise-78', service: 'pare-brise', site: 'Saint-Cloud', updatedAt: '2026-01-01T00:00:00Z' };
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('config/reglages', { prestataires: ['ALLO pare-brise 78'], sites: [{ nom: 'Saint-Cloud', adresse: '1 quai' }] });
  await put('demandes/recent', { ...base, plaque: 'RE-001-AA', date: daysAgo(3), statut: 'realisee' });
  await put('demandes/oldOpen', { ...base, plaque: 'OP-002-BB', date: '2025-04-01', statut: 'envoyee' });
  await put('demandes/oldHayon', { ...base, service: 'hayon', plaque: 'HA-003-CC', date: daysAgo(200), statut: 'realisee' });
  await put('demandes/oldDone', { ...base, plaque: 'OD-004-DD', date: '2025-05-10', statut: 'realisee' });
  await put('demandes/veryOld', { ...base, plaque: 'VO-005-EE', date: '2024-12-03', statut: 'annulee' });
  await signUp('fabian@city-drop.com');

  const srv = http.createServer((q, r) => { const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end()); }).listen(8766);
  const b = await chromium.launch();
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ contentType: 'text/javascript',
    body: fs.readFileSync(path.join(process.env.FB_DIR || path.join(__dirname, 'node_modules/firebase'), r.request().url().split('/').pop())) }));
  await p.addInitScript(() => {
    let fb; Object.defineProperty(window, 'firebase', { configurable: true, get: () => fb, set: (v) => {
      fb = v; const init = v.initializeApp.bind(v);
      v.initializeApp = (c) => { const app = init(c); v.firestore().useEmulator('127.0.0.1', 8080); v.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); return app; };
    } });
  });
  await p.goto('http://localhost:8766/#historique'); await p.waitForSelector('#login input');
  await p.fill('#login input[type=email]', 'fabian@city-drop.com'); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button'); await p.waitForTimeout(1500);
  const histPlates = async () => (await p.$$eval('#histWrap .plate', (els) => els.map((e) => e.textContent.trim()))).sort().join(' ');

  ok('opening reads only recent + open + tailgate requests', (await p.textContent('#sync')).includes('3 demandes'));
  ok('history lists those three', (await histPlates()) === 'HA-003-CC OP-002-BB RE-001-AA');
  ok('history offers the older ones', await p.isVisible('#h-older-btn'));
  await p.click('#h-older-btn'); await p.waitForTimeout(800);
  ok('older ones added after the click', (await histPlates()) === 'HA-003-CC OD-004-DD OP-002-BB RE-001-AA VO-005-EE');
  ok('the note disappears once everything is loaded', !(await p.isVisible('#h-older')));
  await put('demandes/veryOld', { ...base, plaque: 'VO-005-EE', date: '2024-12-03', statut: 'realisee', updatedAt: '2026-02-01T00:00:00Z' }); await p.waitForTimeout(600);
  ok('an older request stays live once loaded', (await p.textContent('#histWrap')).includes('Réalisée') && (await p.$$eval('#histWrap .chip', (c) => c.filter((x) => x.textContent === 'Annulée').length)) === 0);
  await del('demandes/recent'); await p.waitForTimeout(600);
  ok('a deleted request leaves the list', !(await histPlates()).includes('RE-001-AA'));

  // Fresh page (reload: a hash change alone keeps the page): the monthly report of an old month loads that month only.
  await p.goto('http://localhost:8766/#bilan'); await p.reload(); await p.waitForTimeout(1500);
  await p.fill('#b-month', '2025-05'); await p.dispatchEvent('#b-month', 'change'); await p.waitForTimeout(800);
  ok('old month report shows its request', (await p.textContent('#b-body')).includes('OD-004-DD'));
  const syncText = await p.textContent('#sync'); ok('…without loading the other old months (' + syncText.trim() + ')', syncText.includes('3 demandes'));
  // Planning on an old day.
  await p.goto('http://localhost:8766/#planning'); await p.reload(); await p.waitForTimeout(1500);
  await p.fill('#dayPick', '2024-12-03'); await p.dispatchEvent('#dayPick', 'change'); await p.waitForTimeout(800);
  ok('planning of an old day shows its request', (await p.textContent('#dayList')).includes('VO-005-EE'));
  // Tailgate follow-up still knows a control from 200 days ago (the year of controls is loaded at opening).
  await p.goto('http://localhost:8766/#hayon'); await p.reload(); await p.waitForTimeout(1500);
  ok('tailgate page still sees the old control', (await p.textContent('#view-hayon')).includes('HA-003-CC'));
  ok('no page error', errs.length === 0); if (errs.length) console.log(errs);

  // Provider screen: its last 40 days and its open requests at opening (the rules accept these filtered lists).
  await put('comptes/allo@test.fr', { role: 'prestataire', prestataireId: 'allo-pare-brise-78', email: 'allo@test.fr' });
  await signUp('allo@test.fr');
  const q = await b.newContext().then((c) => c.newPage()); const qErrs = []; q.on('pageerror', e => qErrs.push(e.message));
  await q.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ contentType: 'text/javascript',
    body: fs.readFileSync(path.join(process.env.FB_DIR || path.join(__dirname, 'node_modules/firebase'), r.request().url().split('/').pop())) }));
  await q.addInitScript(() => {
    let fb; Object.defineProperty(window, 'firebase', { configurable: true, get: () => fb, set: (v) => {
      fb = v; const init = v.initializeApp.bind(v);
      v.initializeApp = (c) => { const app = init(c); v.firestore().useEmulator('127.0.0.1', 8080); v.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); return app; };
    } });
  });
  await put('demandes/provRecent', { ...base, plaque: 'PR-006-FF', date: daysAgo(5), statut: 'realisee' });
  await q.goto('http://localhost:8766/'); await q.waitForSelector('#login input');
  await q.fill('#login input[type=email]', 'allo@test.fr'); await q.fill('#login input[type=password]', 'secret123'); await q.click('#login button'); await q.waitForTimeout(2000);
  await q.click('[data-tab=done]'); await q.waitForTimeout(300);
  const doneText = () => q.textContent('#view-presta');
  ok('provider « Faits » shows the recent one', (await doneText()).includes('PR-006-FF'));
  ok('…not the old ones yet', !(await doneText()).includes('OD-004-DD'));
  ok('provider is offered the older ones', await q.isVisible('[data-older]'));
  await q.click('[data-older]'); await q.waitForTimeout(1000);
  ok('older ones arrive after the click', (await doneText()).includes('OD-004-DD') && !(await q.isVisible('[data-older]')));
  ok('provider: no page error', qErrs.length === 0); if (qErrs.length) console.log(qErrs);
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
