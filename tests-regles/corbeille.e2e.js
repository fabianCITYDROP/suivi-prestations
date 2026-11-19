// Trash (« Corbeille »), end to end against the local emulators (never the real project):
// a request is deleted, lands in the trash, is restored; a grouped wash goes and comes back whole; an item older
// than 20 days is erased at the app's opening; with the OLD rules nothing is deleted. node corbeille.e2e.js <screenshots folder>
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures');
const PROJECT = 'suivi-prestations';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v }
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: val(obj).mapValue.fields }) })
  .then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); });
const list = (c) => fetch(`${FS}/${c}?pageSize=100`, { headers: owner }).then((r) => r.json()).then((j) => j.documents || []);
const exists = (p) => fetch(`${FS}/${p}`, { headers: owner }).then((r) => r.ok);
const ids = (docs) => docs.map((d) => d.name.split('/').pop()).sort().join(',');
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then((r) => r.json());
const setRules = (rules) => fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }) }).then((r) => { if (!r.ok) throw new Error('rules ' + r.status); });
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const check = (ok, what) => { if (!ok) { console.error('ÉCHEC : ' + what); process.exitCode = 1; } else console.log('ok : ' + what); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const e of ['fabian@city-drop.com', 'jerome@city-drop.com']) await signUp(e);
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('comptes/jerome@city-drop.com', { role: 'lecture', email: 'jerome@city-drop.com' });
  await put('config/reglages', { prestataires: ['Khalid', 'ALLO pare-brise 78'], sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' }], flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  const base = { site: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud', modele: 'Renault Master 2023', cubage: 20, date: day(1), dateFin: day(1), debut: '08:30', fin: '19:30', statut: 'envoyee',
    createdAt: new Date(Date.now() - 3 * 864e5).toISOString() };
  const r9 = { ...base, prestataire: 'ALLO pare-brise 78', prestataireId: 'allo-pare-brise-78', service: 'pare-brise', plaque: 'GD-207-NF', prixHT: 360 };
  await put('demandes/r9', r9);
  for (const [id, plaque, debut] of [['g1', 'AB-123-CD', '08:30'], ['g2', 'EF-456-GH', '10:00']])
    await put('demandes/' + id, { ...base, prestataire: 'Khalid', prestataireId: 'khalid', service: 'lavage', formule: 'complet', plaque, debut, prixHT: 42, groupe: 'G1' });
  // Deleted 21 days ago: erased at the next opening of the app. Deleted 18 days ago: stays, orange « 2 j ».
  await put('corbeille/vieille', { demande: { ...r9, plaque: 'OL-000-DD' }, supprimeLe: new Date(Date.now() - 21 * 864e5), supprimePar: 'fabian@city-drop.com' });
  await put('corbeille/bientot', { demande: { ...r9, plaque: 'QR-654-ST', date: day(-17), dateFin: day(-17) }, supprimeLe: new Date(Date.now() - 18 * 864e5), supprimePar: 'jerome@city-drop.com' });

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
  const openReq = async (p, id) => { await p.evaluate(() => { location.hash = 'historique'; }); await p.waitForTimeout(400); await p.locator(`[data-open="${id}"]:visible`).first().click(); await p.waitForTimeout(500); };
  const del = async (p) => { await p.click('[data-delete]'); await p.click("[data-delete-yes]"); await p.waitForTimeout(1500); };
  const toastText = (p) => p.evaluate(() => document.querySelector('.toast, #toast')?.textContent || '');
  const openTrash = async (p) => { await p.evaluate(() => { location.hash = 'corbeille'; }); await p.waitForTimeout(1200); };

  // 1. Opening the app erases what has been in the trash more than 20 days, not the rest.
  const f = await open('fabian@city-drop.com', { width: 1440, height: 900 });
  await f.waitForTimeout(6000);
  check(!(await exists('corbeille/vieille')) && await exists('corbeille/bientot'), "à l'ouverture, la demande supprimée il y a 21 jours est effacée, celle d'il y a 18 jours reste");
  // 2. Deleting a request: copy in the trash, request gone, trace in the history.
  await openReq(f, 'r9'); await del(f);
  check(!(await exists('demandes/r9')) && await exists('corbeille/r9'), 'la demande supprimée part à la corbeille');
  check((await list('historique')).some((d) => d.fields.action.stringValue === 'suppression'), "la suppression est tracée dans l'historique");
  // 3. A grouped wash goes to the trash whole.
  await openReq(f, 'g1'); await del(f);
  check(ids(await list('corbeille')) === 'bientot,g1,g2,r9', 'le lavage groupé part entier à la corbeille (' + ids(await list('corbeille')) + ')');
  // 4. The Corbeille page.
  await openTrash(f);
  const cards = await f.locator('.trash-card').count();
  check(cards === 3, '3 cartes : le groupe, le pare-brise, la plus ancienne (' + cards + ')');
  check(await f.locator('.trash-days.soon').count() === 1, 'la plus ancienne a la pastille orange');
  await f.screenshot({ path: `${OUT}/corbeille-ordi.png` });
  const m = await open('fabian@city-drop.com', { width: 390, height: 844 });
  await openTrash(m);
  check(await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, 'pas de débordement sur téléphone');
  await m.screenshot({ path: `${OUT}/corbeille-telephone.png`, fullPage: true });
  // 5. Read-only account: sees the list, no « Restaurer ».
  const j = await open('jerome@city-drop.com', { width: 1440, height: 900 });
  await openTrash(j);
  check(await j.locator('.trash-card').count() === 3 && await j.locator('[data-trash-restore]').count() === 0, 'Jérôme (lecture) voit la corbeille sans bouton Restaurer');
  await j.close();
  // 6. Restore the group and the windscreen.
  await f.locator('[data-trash-restore="g1,g2"], [data-trash-restore="g2,g1"]').click(); await f.waitForTimeout(1500);
  check(await exists('demandes/g1') && await exists('demandes/g2') && !(await exists('corbeille/g1')), 'le lavage groupé revient entier');
  await f.locator('[data-trash-restore="r9"]').click(); await f.waitForTimeout(1500);
  check(await exists('demandes/r9') && !(await exists('corbeille/r9')), 'le pare-brise revient');
  const back = await fetch(`${FS}/demandes/r9`, { headers: owner }).then((r) => r.json());
  check(+(back.fields.prixHT.integerValue ?? back.fields.prixHT.doubleValue) === 360 && back.fields.plaque.stringValue === 'GD-207-NF' && back.fields.statut.stringValue === 'envoyee', 'la demande revient telle quelle (prix, plaque, statut)');
  check((await list('historique')).filter((d) => d.fields.action.stringValue === 'restauration').length === 3, "3 traces « Restauration » dans l'historique");
  // 7. With the OLD rules (not yet republished), nothing is deleted.
  const oldRules = require('child_process').execSync('git show origin/main:src/firestore.rules', { cwd: ROOT }).toString();
  await setRules(oldRules);
  await openReq(f, 'r9'); await del(f);
  check(await exists('demandes/r9'), 'avec les anciennes règles, rien n\'est supprimé');
  console.log('message : ' + await toastText(f));
  console.log(errors.length ? 'ERREURS PAGE\n' + errors.join('\n') : 'aucune erreur dans la page');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
