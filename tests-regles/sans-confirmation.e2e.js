// Prestataire « Sans confirmation » (DHOLLIANDA, Fabian 2026-11-26) : une demande envoyée passe seule en « Confirmée »,
// et une fois son créneau passé elle est comptée faite (contrôle hayon : les 180 jours repartent). Khalid, lui, confirme encore.
// Puis l'interrupteur de Réglages : on le coupe pour DHOLLIANDA, on l'allume pour Khalid. Émulateurs Firebase, aucune donnée réelle.
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/sans-confirmation.e2e.js <dossier>"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-sans-confirmation');
const FS = 'http://127.0.0.1:8080/v1/projects/suivi-prestations/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v }
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: val(obj).mapValue.fields }) })
  .then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); });
const get = (p) => fetch(`${FS}/${p}`, { headers: owner }).then((r) => r.json());
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then((r) => r.json());
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ended = new Date(Date.now() - 60 * 60000), start = new Date(Date.now() - 3 * 3600000);
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('config/reglages', { prestataires: ['Khalid', 'DHOLLIANDA'], sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot' }], flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  await put('prestataires/khalid', { nom: 'Khalid', interventions: true, lavage: true, tarifs: [] });
  await put('prestataires/dhollianda', { nom: 'DHOLLIANDA', hayon: true, lavage: false, interventions: false, tarifs: [] });
  await put('hayons/GA731PM', { plaque: 'GA-731-PM', dernierControle: day(-190) });
  const hy = { prestataire: 'DHOLLIANDA', prestataireId: 'dhollianda', service: 'hayon', source: 'mail', site: 'Saint-Cloud', modele: 'Renault Master 2023', cubage: 20 };
  // Créneau d'aujourd'hui déjà fini (il y a une heure) : compté fait. Créneau de demain : confirmé, pas encore fait.
  await put('demandes/h-passe', { ...hy, plaque: 'GA-731-PM', date: iso(start), debut: hm(start), dateFin: iso(ended), fin: hm(ended), statut: 'envoyee' });
  await put('demandes/h-demain', { ...hy, plaque: 'GB-200-AA', date: day(1), debut: '08:30', fin: '19:30', statut: 'envoyee' });
  await put('demandes/k1', { prestataire: 'Khalid', prestataireId: 'khalid', service: 'lavage', plaque: 'GC-300-BB', site: 'Saint-Cloud', date: day(1), debut: '08:30', fin: '19:30', statut: 'envoyee' });
  await signUp('fabian@city-drop.com');
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8765);
  const b = await chromium.launch();
  const errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message); });
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
  await p.fill('#login input[type=email]', 'fabian@city-drop.com'); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
  await p.waitForTimeout(3000);
  const statut = async (id) => (await get('demandes/' + id)).fields;
  let f = await statut('h-passe');
  if (f.statut.stringValue !== 'realisee' || !f.sansConfirmation?.booleanValue) errors.push('créneau passé pas compté fait : ' + f.statut.stringValue);
  f = await statut('h-demain');
  if (f.statut.stringValue !== 'confirmee' || !f.sansConfirmation?.booleanValue) errors.push('demain pas confirmé : ' + f.statut.stringValue);
  f = await statut('k1');
  if (f.statut.stringValue !== 'envoyee' || f.sansConfirmation) errors.push('Khalid ne doit pas être confirmé seul : ' + f.statut.stringValue);
  await p.evaluate(() => { location.hash = 'hayon'; }); await p.waitForTimeout(900);
  await p.screenshot({ path: `${OUT}/1-hayon.png` });
  const ga = await p.locator('[data-hy-key="GA731PM"]').innerText();
  if (!/180|À jour|Reste/.test(ga)) errors.push('GA-731-PM pas remis à 180 jours : ' + ga.replace(/\s+/g, ' '));
  // Réglages › DHOLLIANDA : l'interrupteur est allumé d'office ; on le coupe, puis on l'allume pour Khalid.
  await p.evaluate(() => { location.hash = 'reglages'; }); await p.waitForTimeout(900);
  await p.locator('[data-rg-open="prov:DHOLLIANDA"]').click(); await p.waitForTimeout(800);
  const sw = p.locator('.team-sheet [data-prov-alone]');
  if (!(await sw.isChecked())) errors.push('DHOLLIANDA pas « sans confirmation » d\'office');
  await sw.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/2-reglages-dhollianda.png` });
  await sw.click({ force: true }); await p.waitForTimeout(900);
  f = (await get('prestataires/dhollianda')).fields;
  if (f.sansConfirmation?.booleanValue !== false) errors.push('coupure non enregistrée');
  await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
  await p.locator('[data-rg-open="prov:Khalid"]').click(); await p.waitForTimeout(800);
  await p.locator('.team-sheet [data-prov-alone]').click({ force: true }); await p.waitForTimeout(1500);
  f = await statut('k1');
  if (f.statut.stringValue !== 'confirmee') errors.push('Khalid allumé : demande pas confirmée : ' + f.statut.stringValue);
  await b.close(); srv.close();
  console.log(errors.length ? 'ERREURS :\n' + errors.join('\n') : 'OK : aucune erreur');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
