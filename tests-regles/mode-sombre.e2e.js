// Bouton mode clair / sombre de la barre du haut (équipe et prestataire), dans les émulateurs Firebase (aucune donnée réelle).
// Vérifie : le bouton bascule, le choix reste après rechargement, revenir au mode du téléphone efface le choix.
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/mode-sombre.e2e.js <dossier>"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-mode-sombre');
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
  const sc = { site: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud', prestataire: 'Khalid', prestataireId: 'khalid' };
  await put('comptes/khalid@lavage.fr', { role: 'prestataire', prestataireId: 'khalid', email: 'khalid@lavage.fr' });
  await put('config/reglages', { prestataires: ['Khalid'], sites: [{ nom: 'Saint-Cloud', adresse: sc.adresse }], flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  await put('prestataires/khalid', { nom: 'Allo Pare-Brise', interventions: true, lavage: true, pareBrise: true });
  await put('demandes/t1', { ...sc, statut: 'confirmee', service: 'lavage', plaque: 'GA-731-PM', modele: 'Renault Master 2023', cubage: 20, date: day(0), debut: '09:00', fin: '12:00' });
  await put('demandes/t2', { ...sc, statut: 'envoyee', service: 'pare-brise', plaque: 'FK-402-ZD', modele: 'Peugeot Boxer', cubage: 12, date: day(0), debut: '13:00', fin: '17:00' });
  await put('comptes/equipe@city-drop.com', { role: 'admin', email: 'equipe@city-drop.com' }); await signUp('equipe@city-drop.com');
  await signUp('khalid@lavage.fr');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await seed();
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8765);
  const b = await chromium.launch();
  const errors = [];
  async function open(email, opts) {
    const ctx = await b.newContext(opts);
    const p = await ctx.newPage();
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
    await p.goto('http://localhost:8765/'); await p.waitForSelector('#login input'); await p.waitForTimeout(500);
    await p.fill('#login [data-view="login"] input[type=email]', email); await p.fill('#login input[type=password]', 'secret123');
    await p.press('#login input[type=password]', 'Enter');
    await p.waitForSelector('#login', { state: 'detached' }); await p.waitForTimeout(1800);
    return { p, ctx };
  }
  const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const theme = (p) => p.evaluate(() => [document.documentElement.dataset.theme || '', localStorage.getItem('presta-theme') || '']);
  const phone = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const desk = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 };
  const cases = [['equipe-tel', 'equipe@city-drop.com', phone], ['presta-tel', 'khalid@lavage.fr', phone], ['equipe-ordi', 'equipe@city-drop.com', desk], ['presta-ordi', 'khalid@lavage.fr', desk]];
  for (const [name, email, opts] of cases) {
    const { p, ctx } = await open(email, { ...opts, colorScheme: 'light' });
    const before = await bg(p);
    await p.screenshot({ path: `${OUT}/${name}-1-clair.png` });
    await p.locator('header.top').screenshot({ path: `${OUT}/${name}-1-clair-barre.png` });
    await p.click('#themeBtn'); await p.waitForTimeout(600);
    if ((await theme(p)).join() !== 'dark,dark') errors.push(name + ' : pas passé en sombre ' + await theme(p));
    if (await bg(p) === before) errors.push(name + ' : le fond n\'a pas changé');
    if (await p.getAttribute('#themeBtn', 'aria-label') !== 'Passer en mode clair') errors.push(name + ' : libellé');
    await p.screenshot({ path: `${OUT}/${name}-2-sombre.png` });
    await p.locator('header.top').screenshot({ path: `${OUT}/${name}-2-sombre-barre.png` });
    await p.reload(); await p.waitForSelector('#themeBtn'); await p.waitForTimeout(2500);
    if ((await theme(p)).join() !== 'dark,dark') errors.push(name + ' : choix perdu au rechargement');
    await p.click('#themeBtn'); await p.waitForTimeout(600);
    if ((await theme(p)).join() !== ',') errors.push(name + ' : revenir au clair doit effacer le choix ' + await theme(p));
    // Bouton de déconnexion armé : le bouton du mode s'efface pour laisser la place à « Se déconnecter ? ».
    if (name === 'equipe-tel') { await p.click('#signOutBtn'); await p.waitForTimeout(400); await p.locator('header.top').screenshot({ path: `${OUT}/${name}-3-deconnexion-armee.png` }); }
    await ctx.close();
  }
  { // Téléphone réglé en sombre : le bouton montre le soleil et passe en clair.
    const { p, ctx } = await open('khalid@lavage.fr', { ...phone, colorScheme: 'dark' });
    await p.screenshot({ path: `${OUT}/presta-tel-telephone-sombre.png` });
    await p.click('#themeBtn'); await p.waitForTimeout(600);
    if ((await theme(p)).join() !== 'light,light') errors.push('téléphone sombre : pas passé en clair ' + await theme(p));
    await p.screenshot({ path: `${OUT}/presta-tel-telephone-sombre-force-clair.png` });
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(errors.length ? 'ERREURS :\n' + errors.join('\n') : 'OK : aucune erreur');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
