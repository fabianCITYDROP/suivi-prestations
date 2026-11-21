// Change history, end to end against the local emulators (never the real project):
// the team changes a date, a provider answers, the app applies it, the history shows all three; then, with the
// OLD rules (history not yet allowed), saving still works. node historique.e2e.js <screenshots folder>
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures');
const PROJECT = 'suivi-prestations';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v }
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: val(obj).mapValue.fields }) })
  .then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); });
const list = (c) => fetch(`${FS}/${c}?pageSize=100`, { headers: owner }).then((r) => r.json()).then((j) => j.documents || []);
const get = (p) => fetch(`${FS}/${p}`, { headers: owner }).then((r) => r.json());
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then((r) => r.json());
const setRules = (rules) => fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }) }).then((r) => { if (!r.ok) throw new Error('rules ' + r.status); });
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const check = (ok, what) => { if (!ok) { console.error('ÉCHEC : ' + what); process.exitCode = 1; } else console.log('ok : ' + what); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const e of ['fabian@city-drop.com', 'khalid@lavage.fr']) await signUp(e);
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('comptes/khalid@lavage.fr', { role: 'prestataire', prestataireId: 'khalid', email: 'khalid@lavage.fr' });
  await put('config/reglages', { prestataires: ['Khalid'], sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' }], flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  await put('prestataires/khalid', { nom: 'Khalid', tarifs: [{ service: 'lavage', cubageMin: null, cubageMax: null, prixHT: 37 }] });
  await put('demandes/r9', { prestataire: 'Khalid', prestataireId: 'khalid', service: 'lavage', formule: 'complet', plaque: 'GD-207-NF', modele: 'Renault Master 2023', cubage: 20,
    site: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud', date: day(1), dateFin: day(1), debut: '08:30', fin: '19:30', statut: 'envoyee', prixHT: 37,
    createdAt: new Date(Date.now() - 3 * 864e5).toISOString(), sentAt: new Date(Date.now() - 3 * 864e5).toISOString() });

  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8765);
  const b = await chromium.launch();
  const errors = [];
  async function open(email, viewport) {
    const p = await b.newPage({ viewport, deviceScaleFactor: 2 });
    p.on('pageerror', (e) => errors.push(email + ': ' + e.message));
    await p.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ contentType: 'text/javascript',
      body: fs.readFileSync(path.join(__dirname, 'node_modules/firebase', r.request().url().split('/').pop())) }));
    await p.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
    await p.addInitScript(() => {
      let fb; Object.defineProperty(window, 'firebase', { configurable: true, get: () => fb, set: (v) => {
        fb = v; const init = v.initializeApp.bind(v);
        v.initializeApp = (c) => { const app = init(c); v.firestore().useEmulator('127.0.0.1', 8080); v.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); return app; };
      } });
    });
    await p.goto('http://localhost:8765/'); await p.waitForSelector('#login input');
    await p.fill('#login input[type=email]', email); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
    await p.waitForTimeout(1800);
    return p;
  }
  const openR9 = async (p) => { await p.evaluate(() => { location.hash = 'historique'; }); await p.waitForTimeout(400); await p.locator('#histWrap [data-open="r9"]').first().click(); await p.waitForTimeout(500); await p.click('.team-sheet [data-plan-edit]'); await p.waitForTimeout(400); };

  // 1. The team moves the date.
  const f = await open('fabian@city-drop.com', { width: 1440, height: 900 });
  await openR9(f);
  check(await f.isVisible('#historyBox summary'), "le bloc « Historique des modifications » s'affiche sur une demande enregistrée");
  await f.fill('#f-date', day(2)); await f.click('#saveBtn'); await f.waitForTimeout(1200);
  // 2. The provider takes the job, then says it is done.
  const k = await open('khalid@lavage.fr', { width: 390, height: 844 });
  await k.click('[data-take="r9"]'); await k.waitForTimeout(1200);
  await k.close();
  await f.waitForTimeout(1500); // the team app applies the answer by itself
  let entries = (await list('historique')).map((d) => d.fields);
  const actions = entries.map((e) => e.action.stringValue).sort();
  check(JSON.stringify(actions) === JSON.stringify(['modification', 'reponse', 'statut']), 'trois traces : date changée, réponse du prestataire, statut automatique (' + actions + ')');
  check(entries.every((e) => e.at.timestampValue), "chaque trace porte l'heure du serveur");
  check(entries.some((e) => e.par.stringValue === 'khalid@lavage.fr' && e.action.stringValue === 'reponse'), 'la réponse est signée par Khalid');
  // 3. The history on the request.
  await openR9(f);
  await f.click('#historyBox summary'); await f.waitForTimeout(1000);
  const text = await f.textContent('#historyBody');
  check(text.includes('Pris en charge') && text.includes('Confirmée') && text.includes('Création'), "l'historique affiché contient la réponse, le statut et la création");
  await f.locator('#historyBox').scrollIntoViewIfNeeded();
  await f.screenshot({ path: `${OUT}/historique-ordi.png` });
  const m = await open('fabian@city-drop.com', { width: 390, height: 844 });
  await openR9(m); await m.click('#historyBox summary'); await m.waitForTimeout(1000);
  await m.locator('#historyBox').scrollIntoViewIfNeeded();
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, 'pas de débordement sur téléphone');
  await m.screenshot({ path: `${OUT}/historique-telephone.png` });
  // 4. With the old rules (history refused), saving a request still works.
  const oldRules = require('child_process').execSync('git show origin/main:src/firestore.rules', { cwd: ROOT }).toString();
  await setRules(oldRules);
  await openR9(f);
  await f.fill('#f-date', day(4)); await f.click('#saveBtn'); await f.waitForTimeout(1500);
  const r9 = await get('demandes/r9');
  check(r9.fields.date.stringValue === day(4), 'avec les anciennes règles, la modification est quand même enregistrée');
  check((await list('historique')).length === 3, 'avec les anciennes règles, pas de trace (normal)');
  console.log(errors.length ? 'ERREURS PAGE\n' + errors.join('\n') : 'aucune erreur dans la page');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
