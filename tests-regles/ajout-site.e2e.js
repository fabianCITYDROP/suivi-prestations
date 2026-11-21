// Bug 2026-11-21 : dans Réglages › Sites, un site ajouté avec la touche Entrée (ou sur Safari, où le clic sur « Ajouter »
// laisse le curseur dans le champ) était enregistré mais n'apparaissait qu'en rouvrant la feuille.
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/ajout-site.e2e.js [dossier]"
// (ROOT=<autre copie du dépôt> pour rejouer sur l'ancienne version)
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = process.env.ROOT || path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-ajout-site');
const FS = 'http://127.0.0.1:8080/v1/projects/suivi-prestations/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v }
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: val(obj).mapValue.fields }) })
  .then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('config/reglages', { prestataires: ['Allo Pare-Brise', 'Khalid'],
    sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot' }, { nom: 'La Défense', adresse: '' }],
    flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  await fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'fabian@city-drop.com', password: 'secret123', returnSecureToken: true }) });
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8765);
  const b = await chromium.launch();
  const fails = [];
  const ctx = await b.newContext({ viewport: { width: 1262, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => fails.push('Erreur page : ' + e.message));
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
  await p.waitForTimeout(2000);
  await p.evaluate(() => { location.hash = 'reglages'; }); await p.waitForTimeout(900);
  const names = () => p.$$eval('#s-sites .rg-site b', (l) => l.map((x) => x.textContent.trim()));

  await p.locator('[data-rg-open="sites"]').first().click(); await p.waitForTimeout(700);
  // 1. Touche Entrée
  await p.fill('#s-newsite', 'Montpellier - Pérols'); await p.press('#s-newsite', 'Enter'); await p.waitForTimeout(900);
  if (!(await names()).includes('Montpellier - Pérols')) fails.push('Entrée : site absent de la feuille ' + await names());
  await p.screenshot({ path: path.join(OUT, '1-apres-entree.png') });
  // 2. Comme Safari : on clique « Ajouter » sans que le champ perde le curseur
  await p.fill('#s-newsite', 'Bordeaux Lac');
  await p.evaluate(() => { document.querySelector('#s-newsite').focus(); document.querySelector('#s-addsite').click(); }); await p.waitForTimeout(900);
  if (!(await names()).includes('Bordeaux Lac')) fails.push('Clic façon Safari : site absent de la feuille ' + await names());
  // 3. Clic normal
  await p.fill('#s-newsite', 'Lille'); await p.click('#s-addsite'); await p.waitForTimeout(900);
  if (!(await names()).includes('Lille')) fails.push('Clic : site absent de la feuille ' + await names());
  // le curseur part dans l'adresse du nouveau site
  const focused = await p.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  if (focused !== 'Adresse de Lille') fails.push('Curseur pas dans la nouvelle adresse : ' + focused);
  await p.screenshot({ path: path.join(OUT, '2-trois-sites-ajoutes.png') });
  await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
  // 4. Même chose pour la flotte (même mécanisme)
  await p.locator('[data-rg-open="fleet"]').first().click(); await p.waitForTimeout(700);
  await p.fill('#s-newmodel', 'Opel Movano 2025'); await p.press('#s-newmodel', 'Enter'); await p.waitForTimeout(900);
  const models = await p.$$eval('#s-fleet b', (l) => l.map((x) => x.textContent.trim()));
  if (!models.includes('Opel Movano 2025')) fails.push('Flotte, Entrée : modèle absent ' + models);
  // 5. Bien enregistré dans la base
  const doc = await fetch(`${FS}/config/reglages`, { headers: owner }).then((r) => r.json());
  const saved = doc.fields.sites.arrayValue.values.map((v) => v.mapValue.fields.nom.stringValue);
  for (const n of ['Montpellier - Pérols', 'Bordeaux Lac', 'Lille']) if (!saved.includes(n)) fails.push('Pas enregistré : ' + n);
  await b.close(); srv.close();
  console.log(fails.length ? 'ÉCHEC\n- ' + fails.join('\n- ') : 'OK : les sites ajoutés apparaissent tout de suite (Entrée, clic, façon Safari) et sont enregistrés');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
