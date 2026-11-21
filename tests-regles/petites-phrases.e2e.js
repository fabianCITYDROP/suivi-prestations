// Captures des feuilles et onglets prestataire où des petites phrases d'aide ont été retirées (À valider, Signaler,
// Véhicule absent, feuille d'un véhicule d'« À venir », Autre mois), dans les émulateurs Firebase (aucune donnée réelle).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/petites-phrases.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-petites-phrases');
const pre = process.argv[3] === 'avant' ? 'avant-' : 'apres-';
const FS = 'http://127.0.0.1:8080/v1/projects/suivi-prestations/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v }
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: val(obj).mapValue.fields }) })
  .then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); });
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then((r) => r.json());
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const sc = { site: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud', prestataire: 'Khalid', prestataireId: 'khalid' };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await put('comptes/khalid@lavage.fr', { role: 'prestataire', prestataireId: 'khalid', email: 'khalid@lavage.fr' });
  await put('config/reglages', { prestataires: ['Khalid'], sites: [{ nom: 'Saint-Cloud', adresse: sc.adresse }], flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  await put('prestataires/khalid', { nom: 'Khalid', interventions: true, lavage: true });
  await put('demandes/v1', { ...sc, statut: 'envoyee', service: 'lavage', plaque: 'GT-910-AB', modele: 'Renault Master 2023', cubage: 20, date: day(1), debut: '09:00', fin: '12:00' });
  await put('demandes/u1', { ...sc, statut: 'confirmee', service: 'lavage', plaque: 'EZ-655-LM', modele: 'Citroën Jumper', cubage: 17, date: day(2), debut: '14:00', fin: '17:00' });
  await signUp('khalid@lavage.fr');
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8765);
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
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
  await p.fill('#login input[type=email]', 'khalid@lavage.fr'); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
  await p.waitForTimeout(1800);
  const shot = async (n) => { await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/${pre}${n}.png` }); };
  const close = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(500); };
  await p.click('[data-tab="validate"]'); await shot('1-a-valider');
  await p.click('[data-sheet-open]'); await shot('2-signaler'); await close();
  await p.click('[data-tab="upcoming"]'); await p.waitForTimeout(400);
  await p.click('[data-veh="u1"]'); await shot('3-feuille-vehicule');
  await p.click('[data-asheet] [data-act="absent"]'); await shot('4-vehicule-absent'); await close();
  await p.click('[data-tab="done"]'); await p.waitForTimeout(400);
  await p.click('[data-month-more]'); await shot('5-autre-mois');
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
