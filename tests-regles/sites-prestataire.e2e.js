// Nouvelle demande : seuls les sites donnés au prestataire (Garages des mails) sont proposés ; tous s'il n'en a aucun.
// dans les émulateurs Firebase (aucune donnée réelle).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/sites-prestataire.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-sites-prestataire');
const BEFORE = process.argv[3] === 'avant';
const FS = 'http://127.0.0.1:8080/v1/projects/suivi-prestations/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v }
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: val(obj).mapValue.fields }) })
  .then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); });
const unval = (v) => v == null ? v : 'stringValue' in v ? v.stringValue : 'doubleValue' in v ? v.doubleValue : 'integerValue' in v ? +v.integerValue
  : 'booleanValue' in v ? v.booleanValue : 'nullValue' in v ? null : v;
const list = (c) => fetch(`${FS}/${c}?pageSize=200`, { headers: owner }).then((r) => r.json())
  .then((j) => (j.documents || []).map((d) => ({ id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, unval(v)])) })));
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then((r) => r.json());
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

async function seed() {
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  const names = ['Saint-Cloud', 'La Défense', 'Aulnay', 'Coignières', 'Paris-Centre', 'Lille', 'Bordeaux Bègles', 'Bordeaux Mérignac', 'Mantes La Jolie',
    'Montpellier - Castelnau', 'Montpellier - Pérols', 'Meaux', 'Marseille - Aubagne'];
  await put('config/reglages', { prestataires: ['ALLO pare-brise 78', 'Khalid', 'DSAT (du sol au toit)'], sites: names.map((nom) => ({ nom, adresse: '' })),
    flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  await put('config/garages', { liste: [
    { garage: 'Allo pare-brise', prestataire: 'ALLO pare-brise 78', site: 'La Défense' },
    { garage: 'Allo pare-brise Aulnay', prestataire: 'ALLO pare-brise 78', site: 'Aulnay' },
    { garage: 'Allo pare-brise Saint-Cloud', prestataire: 'ALLO pare-brise 78', site: 'Saint-Cloud' },
    { garage: 'Du sol au toit', prestataire: 'DSAT (du sol au toit)', site: 'La Défense' },
  ] });
  await put('prestataires/allo-pare-brise-78', { nom: 'ALLO pare-brise 78', pareBrise: true, lavage: true, interventions: true });
  await put('prestataires/khalid', { nom: 'Khalid', lavage: true, interventions: true });
  await put('prestataires/dsat-du-sol-au-toit', { nom: 'DSAT (du sol au toit)', lavage: true });
  await put('demandes/m1', { prestataire: 'Khalid', prestataireId: 'khalid', statut: 'envoyee', service: 'lavage', site: 'Meaux', adresse: '',
    plaque: 'FK-402-ZD', modele: 'Renault Master 2023', cubage: 20, date: day(1), dateFin: day(1), debut: '09:00', fin: '12:00' });
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
  const ok = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) errors.push(label); };
  async function open(opts) {
    const ctx = await b.newContext(opts);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { console.log('PAGEERR', e.message); errors.push('page: ' + e.message); });
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
    return { p, ctx };
  }
  const phone = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const desk = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 };
  const shot = (p, name) => p.screenshot({ path: `${OUT}/${BEFORE ? 'avant-' : ''}${name}.png` });
  const sites = (p) => p.$$eval('#ndSites [data-nd-site]', (bs) => bs.map((x) => x.dataset.ndSite));
  const toSites = async (p) => { await p.$eval('#ndSites', (el) => { const box = document.querySelector('.nd-scroll'); box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 220; }); await p.waitForTimeout(300); };
  for (const [scheme, opts] of [['light', phone], ['dark', { ...phone, colorScheme: 'dark' }], ['ordi', desk]]) {
    const { p, ctx } = await open({ ...opts, colorScheme: opts.colorScheme || 'light' });
    await p.click('#newOnDay'); await p.waitForTimeout(700);
    await p.click('[data-nd-svc="pare-brise"]'); await p.waitForTimeout(300);
    if (!BEFORE) ok(`${scheme}: ALLO -> its 3 sites`, JSON.stringify(await sites(p)) === '["Saint-Cloud","La Défense","Aulnay"]');
    await toSites(p); await shot(p, `${scheme}-1-allo`);
    await p.click('[data-nd-svc="lavage"]'); await p.click('[data-nd-prov="Khalid"]'); await p.waitForTimeout(300);
    ok(`${scheme}: Khalid (no site given) -> all 13 sites`, (await sites(p)).length === 13);
    await toSites(p); await shot(p, `${scheme}-2-khalid-tous`);
    if (scheme === 'light' && !BEFORE) {
      await p.click('[data-nd-site="Meaux"]'); await p.click('[data-nd-prov="ALLO pare-brise 78"]'); await p.waitForTimeout(300);
      ok('site already chosen (Meaux) stays shown and chosen for ALLO', JSON.stringify(await sites(p)) === '["Saint-Cloud","La Défense","Aulnay","Meaux"]' && (await p.inputValue('#f-site')) === 'Meaux');
      await toSites(p); await shot(p, 'light-3-site-deja-choisi');
      await p.click('[data-nd-prov="DSAT (du sol au toit)"]'); await p.waitForTimeout(300);
      ok('DSAT -> La Défense (+ Meaux already chosen)', JSON.stringify(await sites(p)) === '["La Défense","Meaux"]');
    }
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
