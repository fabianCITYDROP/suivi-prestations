// Connexion et navigation de l'équipe façon iPhone : captures (téléphone clair / sombre, ordinateur) et vrai parcours
// (mauvais mot de passe, « Mot de passe oublié », connexion, menu « Plus », passage d'une page à l'autre),
// dans les émulateurs Firebase (aucune donnée réelle).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/connexion-navigation.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-connexion');
const BEFORE = process.argv[3] === 'avant';
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

async function seed() {
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  const P = { khalid: 'Khalid', allo: 'Allo Pare-Brise', dsat: 'Du Sol au Toit' };
  await put('config/reglages', { prestataires: Object.values(P), sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' }, { nom: 'Gennevilliers', adresse: '12 rue du Port' }], flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  for (const [id, nom] of Object.entries(P)) await put('prestataires/' + id, { nom, interventions: true, tarifs: [] });
  const base = { modele: 'Renault Master 2023', cubage: 20, site: 'Saint-Cloud', adresse: 'Quai Carnot', debut: '09:00', fin: '12:00', prixHT: 37, service: 'lavage' };
  const plates = ['GA-731-PM', 'FT-219-ZB', 'HB-550-TR', 'GD-108-QA'];
  for (const [i, plaque] of plates.entries()) await put('demandes/d' + i, { ...base, plaque, date: day(0), prestataire: 'Khalid', prestataireId: 'khalid', statut: i ? 'envoyee' : 'a_envoyer' });
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
    await p.goto('http://localhost:8765/'); await p.waitForSelector('#login input'); await p.waitForTimeout(500);
    return { p, ctx };
  }
  const login = async (p) => {
    await p.fill('#login [data-view="login"] input[type=email]', 'fabian@city-drop.com');
    await p.fill('#login input[type=password]', 'secret123');
    await p.click('#login [data-view="login"] button[type=submit]');
    await p.waitForSelector('#login', { state: 'detached' }); await p.waitForTimeout(1800);
  };
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const pre = BEFORE ? 'avant-' : '';
  const shots = [['light', phone], ['dark', phone], ['ordi', { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 }]];
  for (const [name, opts] of shots) {
    const { p, ctx } = await open({ ...opts, colorScheme: name === 'dark' ? 'dark' : 'light' });
    const s = (n) => p.screenshot({ path: `${OUT}/${pre}${name}-${n}.png` });
    await s('1-connexion');
    // mauvais mot de passe
    await p.fill('#login [data-view="login"] input[type=email]', 'fabian@city-drop.com');
    await p.fill('#login input[type=password]', 'mauvais');
    await p.click('#login [data-view="login"] button[type=submit]'); await p.waitForTimeout(1200);
    if (await p.locator('#login [data-view="login"] .login-error').isHidden()) errors.push(name + ' : pas de message pour un mauvais mot de passe');
    await s('2-erreur');
    // mot de passe oublié
    await p.click('#login [data-go="reset"]'); await p.waitForTimeout(600); await s('3-oublie');
    await p.click('#login [data-view="reset"] button[type=submit]'); await p.waitForTimeout(1500);
    if (await p.locator('#login .login-sent').isHidden()) errors.push(name + ' : pas de confirmation après « Recevoir le lien »');
    await s('4-lien-envoye');
    await p.click('#login [data-go="login"]'); await p.waitForTimeout(600);
    await login(p);
    await s('5-planning');
    // menu « Plus »
    await p.click('#navMore summary'); await p.waitForTimeout(600); await s('6-plus');
    const reglages = p.locator(BEFORE ? '#navMore [data-view="reglages"]' : '.more-sheet [data-more-view="reglages"], #navMore[open] [data-view="reglages"]').first();
    await reglages.click(); await p.waitForTimeout(700);
    if (await p.locator('#view-reglages').isHidden()) errors.push(name + ' : Réglages ne s\'ouvre pas depuis « Plus »');
    await s('7-reglages');
    await p.click('nav.tabs [data-view="retours"]'); await p.waitForTimeout(120); await s('8-transition');
    await p.waitForTimeout(600);
    if (await p.locator('#view-retours').isHidden()) errors.push(name + ' : Retours ne s\'ouvre pas');
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
