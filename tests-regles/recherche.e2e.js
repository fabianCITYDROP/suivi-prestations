// Plate search on the Planning: today, next and last request of a vehicle; a full plate also reads its older requests.
// Run from tests-regles/ after `npm install`: npm run recherche (local emulators only, Playwright must be installed).
// SHOTS=<folder> also saves screenshots (computer and phone).
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

const daysAhead = (n) => daysAgo(-n);

(async () => {
  const base = { prestataire: 'ALLO pare-brise 78', prestataireId: 'allo-pare-brise-78', service: 'lavage', site: 'Saint-Cloud', debut: '09:00', fin: '11:00', updatedAt: '2026-01-01T00:00:00Z' };
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('config/reglages', { prestataires: ['ALLO pare-brise 78'], sites: [{ nom: 'Saint-Cloud', adresse: '1 quai' }] });
  await put('demandes/today', { ...base, plaque: 'PL-100-AA', modele: 'Opel Movano', cubage: 20, date: daysAgo(0), statut: 'envoyee' });
  await put('demandes/next', { ...base, plaque: 'PL-100-AA', service: 'pare-brise', date: daysAhead(4), statut: 'a_envoyer' });
  await put('demandes/later', { ...base, plaque: 'PL-100-AA', date: daysAhead(9), statut: 'a_envoyer' });
  await put('demandes/oldMail', { ...base, plaque: 'PL100AA', date: '2025-05-10', statut: 'realisee' });
  await put('demandes/older', { ...base, plaque: 'PL-100-AA', date: '2025-03-02', statut: 'realisee' });
  await put('demandes/otherOld', { ...base, plaque: 'ZZ-999-ZZ', date: '2025-05-11', statut: 'realisee' });
  await put('demandes/twin', { ...base, plaque: 'PL-100-AB', date: daysAgo(6), statut: 'realisee' });
  await signUp('fabian@city-drop.com');

  const srv = http.createServer((q, r) => { const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end()); }).listen(8766);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: process.env.SHOTS ? 2 : 1 }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ contentType: 'text/javascript',
    body: fs.readFileSync(path.join(process.env.FB_DIR || path.join(__dirname, 'node_modules/firebase'), r.request().url().split('/').pop())) }));
  await p.addInitScript(() => {
    let fb; Object.defineProperty(window, 'firebase', { configurable: true, get: () => fb, set: (v) => {
      fb = v; const init = v.initializeApp.bind(v);
      v.initializeApp = (c) => { const app = init(c); v.firestore().useEmulator('127.0.0.1', 8080); v.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); return app; };
    } });
  });
  await p.goto('http://localhost:8766/#planning'); await p.waitForSelector('#login input');
  await p.fill('#login input[type=email]', 'fabian@city-drop.com'); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button'); await p.waitForTimeout(1500);
  const box = () => p.textContent('#plateResults');
  const shot = async (name) => process.env.SHOTS && p.screenshot({ path: path.join(process.env.SHOTS, name) });

  ok('nothing shown while the field is empty', !(await p.isVisible('#plateResults')));
  await p.fill('#plateFind', 'pl'); ok('asks for 3 characters', (await box()).includes('au moins 3'));
  await p.fill('#plateFind', 'pl-100'); await p.waitForTimeout(300);
  ok('two plates match a partial plate', (await p.$$eval('#plateResults .pf-card', (c) => c.length)) === 2);
  const first = await p.textContent('#plateResults .pf-card');
  ok('today line', /Aujourd'hui\s*09:00/.test(first) || first.includes('Aujourd'));
  ok('next one is the windscreen in 4 days, with one more after', first.includes('Pare-brise') && first.includes('+1 après'));
  ok('no older read for a partial plate', (await p.textContent('#sync')).includes('4 demandes') && (await box()).includes('Tape la plaque en entier'));
  await shot('1-recherche-partielle-ordi.png');

  await p.fill('#plateFind', 'pl100aa'); await p.waitForTimeout(1200);
  const full = await box();
  ok('full plate: one card', (await p.$$eval('#plateResults .pf-card', (c) => c.length)) === 1);
  ok('last one found in the older requests (mail spelling PL100AA)', full.includes('10 mai 2025'));
  ok('…and only this plate was read (' + (await p.textContent('#sync')).trim() + ')', (await p.textContent('#sync')).includes('6 demandes'));
  await shot('2-plaque-entiere-ordi.png');

  await p.click('#plateResults .pf-line[data-open]'); await p.waitForTimeout(300);
  ok('a line opens the request card over the planning', await p.isVisible('.team-sheet.on') && (await p.textContent('.team-sheet')).includes('PL-100-AA'));
  await p.click('.team-sheet [data-plan-edit]'); await p.waitForTimeout(300);
  ok('« Modifier » opens the request form', await p.isVisible('#view-demande'));
  await p.goto('http://localhost:8766/#planning'); await p.waitForTimeout(300);
  await p.click('[data-pf-history]'); await p.waitForTimeout(300);
  ok('« Tout l historique » opens the history filtered on the plate', await p.isVisible('#view-historique') && (await p.inputValue('#q')) === 'PL-100-AA');

  await p.goto('http://localhost:8766/#planning'); await p.waitForTimeout(200);
  await p.fill('#plateFind', 'QQ-111-QQ'); await p.waitForTimeout(800);
  ok('unknown plate says so', (await box()).includes('Aucune prestation trouvée'));
  await p.fill('#plateFind', ''); ok('emptying hides the results', !(await p.isVisible('#plateResults')));

  if (process.env.SHOTS) {
    await p.setViewportSize({ width: 390, height: 844 });
    await p.fill('#plateFind', 'PL-100-AA'); await p.waitForTimeout(400);
    await shot('3-plaque-telephone.png');
  }
  ok('no page error', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
