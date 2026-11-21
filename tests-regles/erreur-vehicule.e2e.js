// « Corriger », end to end against the local emulators (never the real project):
// Khalid taps « OK » by mistake, takes it back from « Faits », the team sees it; then the 10 minutes and the old rules.
// node erreur-vehicule.e2e.js <screenshots folder>
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
    site: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud', date: day(0), dateFin: day(0), debut: '08:30', fin: '19:30', statut: 'confirmee', prixHT: 37,
    createdAt: new Date(Date.now() - 3 * 864e5).toISOString(), sentAt: new Date(Date.now() - 3 * 864e5).toISOString(), confirmedAt: new Date(Date.now() - 2 * 864e5).toISOString() });

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

  // 1. Khalid taps « Prestation réalisée » on the wrong vehicle.
  const k = await open('khalid@lavage.fr', { width: 390, height: 844 });
  await k.click('[data-tab="today"]'); await k.waitForTimeout(300);
  await k.click('[data-form="done:r9"]'); await k.click('[data-send="done:r9"]'); await k.waitForTimeout(1500);
  let r9 = await get('demandes/r9');
  check(r9.fields.statut.stringValue === 'realisee', 'le « OK » clôt la demande');
  check(!!r9.fields.retour.mapValue.fields.le?.timestampValue, "le « OK » porte l'heure du serveur");
  // 2. In « Faits », the button is there; he takes it back with a word for the team.
  await k.click('[data-tab="done"]'); await k.waitForTimeout(400);
  check(await k.isVisible('[data-form="undo:r9"]'), 'le bouton « Corriger » s\'affiche dans Faits');
  check((await k.textContent('[data-form="undo:r9"]')).includes('Corriger'), 'bon texte sur le bouton');
  await k.locator('[data-form="undo:r9"]').scrollIntoViewIfNeeded();
  await k.screenshot({ path: `${OUT}/1-bouton-telephone.png` });
  await k.click('[data-form="undo:r9"]'); await k.waitForTimeout(500);
  await k.fill('.job-form [data-note]', "c'était le camion d'à côté");
  await k.screenshot({ path: `${OUT}/2-confirmation-telephone.png` });
  await k.click('[data-send="undo:r9"]'); await k.waitForTimeout(1500);
  r9 = await get('demandes/r9');
  check(r9.fields.statut.stringValue === 'confirmee', 'la demande redevient « confirmée »');
  check(r9.fields.retour.mapValue.fields.etat.stringValue === 'erreur', 'la réponse dit « erreur de véhicule »');
  check(!r9.fields.doneAt, 'la date de passage est effacée');
  await k.click('[data-tab="today"]'); await k.waitForTimeout(400);
  check(await k.isVisible('[data-form="done:r9"]'), 'le véhicule est de nouveau dans « Aujourd\'hui »');
  await k.screenshot({ path: `${OUT}/3-de-retour-aujourdhui.png` });
  const overflow = await k.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, 'pas de débordement sur téléphone');
  // 3. The team sees it in Retours and in the history.
  const f = await open('fabian@city-drop.com', { width: 1440, height: 900 });
  await f.evaluate(() => { location.hash = 'retours'; }); await f.waitForTimeout(800);
  const retours = await f.textContent('#view-retours').catch(() => f.textContent('body'));
  check(retours.includes('« Fait » annulé'), "l'équipe voit « Fait » annulé dans Retours");
  await f.screenshot({ path: `${OUT}/4-retours-equipe.png` });
  const hist = (await list('historique')).map((d) => d.fields).filter((e) => e.action.stringValue === 'reponse');
  check(hist.length === 2 && hist.some((e) => JSON.stringify(e.changes).includes('erreur')), 'deux traces dans l\'historique : le « fait » puis son annulation');
  // 4. Once 10 minutes have passed, the button is gone and the base refuses.
  await k.click('[data-form="done:r9"]'); await k.click('[data-send="done:r9"]'); await k.waitForTimeout(1500);
  await k.evaluate(() => { const now = Date.now(); Date.now = () => now + 11 * 60000; });
  await k.click('[data-tab="done"]'); await k.waitForTimeout(400);
  check(!(await k.isVisible('[data-form="undo:r9"]')), 'après 10 minutes, le bouton disparaît');
  // 5. With the old rules (not yet republished), « Prestation réalisée » still works.
  await put('demandes/r9', { prestataire: 'Khalid', prestataireId: 'khalid', service: 'lavage', plaque: 'GD-207-NF', date: day(0), dateFin: day(0), statut: 'confirmee', prixHT: 37 });
  const oldRules = require('child_process').execSync('git show origin/main:src/firestore.rules', { cwd: ROOT }).toString();
  await setRules(oldRules);
  const k2 = await open('khalid@lavage.fr', { width: 390, height: 844 });
  await k2.click('[data-tab="today"]'); await k2.waitForTimeout(300);
  await k2.click('[data-form="done:r9"]'); await k2.click('[data-send="done:r9"]'); await k2.waitForTimeout(2500);
  r9 = await get('demandes/r9');
  check(r9.fields.statut.stringValue === 'realisee', 'avec les anciennes règles, le « OK » marche toujours');
  check(!(await k2.isVisible('[data-form="undo:r9"]')), 'avec les anciennes règles, pas de bouton (normal)');
  console.log(errors.length ? 'ERREURS PAGE\n' + errors.join('\n') : 'aucune erreur dans la page');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
