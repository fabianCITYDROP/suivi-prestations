// Garages des mails : un garage City-Drop par prestataire ET par site (« Du Sol au Toit » = La Défense,
// « Du Sol au Toit Lille » = Lille). Vérifie que les demandes venues des mails prennent le bon prestataire (jamais un
// nouveau), le bon site, l'adresse et le prix, et qu'une règle posée plus tard corrige le site deviné.
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/garages.e2e.js <dossier>"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = process.env.ROOT || path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-garages');
const BEFORE = process.argv[3] === 'avant';
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
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

const today = new Date().toISOString().slice(0, 10);
const mail = (id, garageMail, plaque) => put('demandes/' + id, { source: 'mail', statut: 'envoyee', service: 'lavage', plaque, garageMail, date: today, dateFin: today, debut: '09:00', fin: '12:00', tache: 'Lavage extérieur + Lavage intérieur', createdAt: new Date().toISOString() });
const field = async (id, k) => (await get('demandes/' + id)).fields?.[k];

async function seed() {
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('config/reglages', { prestataires: ['Allo Pare-Brise', 'Du Sol au Toit', 'Khalid'],
    sites: [{ nom: 'La Défense', adresse: 'Rue des Hautes Pâtures, 92000 Nanterre' }, { nom: 'Lille', adresse: '10 rue de Lille, 59000 Lille' }, { nom: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' }],
    flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  await put('prestataires/du-sol-au-toit', { nom: 'Du Sol au Toit', lavage: true, tarifs: [{ service: 'lavage', formule: 'complet', cubageMin: null, cubageMax: null, prixHT: 42 }] });
  await put('prestataires/allo-pare-brise', { nom: 'Allo Pare-Brise', lavage: true, pareBrise: true, tarifs: [{ service: 'lavage', formule: 'complet', cubageMin: null, cubageMax: null, prixHT: 37 }] });
  await mail('mail-AA111AA', 'Du Sol au Toit', 'AA-111-AA');
  await mail('mail-BB222BB', 'Du Sol au Toit Lille', 'BB-222-BB');
  await mail('mail-CC333CC', 'ALLO pare-brise 78', 'CC-333-CC');
  await put('robot/etat', { passage: new Date().toISOString(), dernierMail: new Date().toISOString(), erreur: '' });
  await signUp('fabian@city-drop.com');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await seed();
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8765);
  const b = await chromium.launch();
  const errors = [];
  async function open(opts) {
    const ctx = await b.newContext(opts);
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
    await p.waitForTimeout(2000);
    await p.evaluate(() => { location.hash = 'reglages'; }); await p.waitForTimeout(900);
    return { p, ctx };
  }
  const row = (p, open) => p.locator(`[data-rg-open="${open}"]`).first();
  const close = async (p) => { await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500); };
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const check = async (id, k, want) => { const f = await field(id, k); const got = f?.stringValue ?? f?.doubleValue ?? f?.integerValue; if (String(got) !== String(want)) errors.push(`${id}.${k} = ${got}, attendu ${want}`); };
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open({ ...phone, colorScheme: scheme });
    const s = (n) => p.screenshot({ path: `${OUT}/${scheme}-${n}.png` });
    if (scheme === 'light') {
      // Sans règle : le mot « Lille » donne le site, le prestataire reste Du Sol au Toit, le prix aussi.
      await check('mail-BB222BB', 'prestataire', 'Du Sol au Toit'); await check('mail-BB222BB', 'site', 'Lille');
      await check('mail-BB222BB', 'adresse', '10 rue de Lille, 59000 Lille'); await check('mail-BB222BB', 'prixHT', 42);
      await check('mail-AA111AA', 'prestataire', 'Du Sol au Toit'); await check('mail-CC333CC', 'prestataire', 'Allo Pare-Brise');
      if ((await field('mail-AA111AA', 'site'))?.stringValue) errors.push('site deviné sans raison pour « Du Sol au Toit »');
    }
    await s('1-reglages');
    await row(p, 'garages').click(); await p.waitForTimeout(700); await s('2-garages');
    if (scheme === 'light') {
      // « Du Sol au Toit » = La Défense : un choix dans la liste suffit.
      await p.locator('[data-garage="Du Sol au Toit"] [data-garage-site]').selectOption('La Défense'); await p.waitForTimeout(1500);
      await check('mail-AA111AA', 'site', 'La Défense'); await check('mail-AA111AA', 'adresse', 'Rue des Hautes Pâtures, 92000 Nanterre'); await check('mail-AA111AA', 'prixHT', 42);
      // Un garage pas encore reçu, ajouté à la main.
      await p.fill('#g-new', 'Allo Pare-Brise Saint-Cloud'); await p.selectOption('#g-prov', 'Allo Pare-Brise'); await p.selectOption('#g-site', 'Saint-Cloud');
      await p.click('#g-add'); await p.waitForTimeout(900);
      const g = await get('config/garages');
      if ((g.fields?.liste?.arrayValue?.values || []).length !== 2) errors.push('garages enregistrés : ' + JSON.stringify(g.fields));
      const reg = await get('config/reglages');
      if ((reg.fields.prestataires.arrayValue.values || []).length !== 3) errors.push('un prestataire a été créé');
      await s('3-garages-apres');
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    await row(p, 'garages').click(); await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/ordi-garages.png` });
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(errors.length ? 'ÉCHECS\n' + errors.join('\n') : 'garages : tout est bon');
  process.exit(errors.length ? 1 : 0);
})();
