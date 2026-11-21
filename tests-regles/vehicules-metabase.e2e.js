// Véhicules de l'export Metabase : une demande reçue par mail se complète (modèle, cubage, prix, site),
// et la plaque tapée dans « Nouvelle demande » remplit modèle + site.
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/vehicules-metabase.e2e.js <dossier>"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const M = require('../apps-script/import-mails.js');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-metabase');
const FS = 'http://127.0.0.1:8080/v1/projects/suivi-prestations/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v }
  : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } }
  : { stringValue: String(v) };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(obj).map(([k, x]) => [k, val(x)])) }) })
  .then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); });
const get = (p) => fetch(`${FS}/${p}`, { headers: owner }).then((r) => r.json());
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then((r) => r.json());
const fr = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); };
let failed = 0; const ok = (what, cond) => { console.log((cond ? '✔ ' : '✘ ') + what); if (!cond) failed++; };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('prestataires/allo-pare-brise-78', { nom: 'ALLO pare-brise 78', tarifs: [
    { service: 'pare-brise', cubageMin: 3, cubageMax: 6, prixHT: 320 }, { service: 'pare-brise', cubageMin: 12, cubageMax: 20, prixHT: 360 }] });
  await put('config/reglages', { prestataires: ['ALLO pare-brise 78'],
    sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' }, { nom: 'La Défense', adresse: '1 parvis de la Défense' }] });
  await put('metabase/flotte', { majLe: new Date().toISOString(), nb: 2, donnees: JSON.stringify({
    GS487PR: ['MOV - 17', '17M3', 'La Def', '2026-11-21'], HK382ML: ['VIVA - 6', '5M3', 'Saint-Cloud', '2026-11-21'] }) });
  const html = `<p>Nous souhaitons une intervention sur notre <b>MOV - 17</b> entre le <b>${fr(1)} 09:00</b> et le <b>${fr(1)} 12:00</b>.</p>
<p>Le véhicule est immatriculé : <b>GS-487-PR</b> (41281 KM).</p><p>Nous souhaitons une intervention pour :<br/>- Remplacement pare-brise<br/></p>
<p>Nom du garage : Allo pare-brise</p><p>Nous vous remercions par avance !</p>`;
  const lu = M.lireMail('Prise de rendez-vous GS-487-PR', html);
  const id = M.idDemande(lu);
  await put('demandes/' + id, { ...lu, mailId: id, sentAt: new Date().toISOString(), createdAt: new Date().toISOString() });
  await signUp('fabian@city-drop.com');
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8772);
  const b = await chromium.launch();
  const errors = [];
  const ctx = await b.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ contentType: 'text/javascript',
    body: fs.readFileSync(path.join(__dirname, 'node_modules/firebase', r.request().url().split('/').pop())) }));
  await p.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await p.addInitScript(() => {
    let fb; Object.defineProperty(window, 'firebase', { configurable: true, get: () => fb, set: (v) => {
      fb = v; const init = v.initializeApp.bind(v);
      v.initializeApp = (c) => { const app = init(c); v.firestore().useEmulator('127.0.0.1', 8080); v.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); return app; };
    } });
  });
  await p.goto('http://localhost:8772/'); await p.waitForSelector('#login input');
  await p.fill('#login input[type=email]', 'fabian@city-drop.com'); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
  await p.waitForTimeout(3000);
  const f = (await get('demandes/' + id)).fields || {};
  const s = (k) => f[k] && (f[k].stringValue ?? f[k].doubleValue ?? f[k].integerValue);
  ok('mail : modèle Opel Movano 2023', s('modele') === 'Opel Movano 2023');
  ok('mail : cubage 17', +s('cubage') === 17);
  ok('mail : prix Allo 360 € HT', +s('prixHT') === 360);
  ok('mail : site La Défense (La Def dans Metabase)', s('site') === 'La Défense' && s('siteAuto') === 'metabase');

  await p.click('#newOnDay'); await p.waitForTimeout(700);
  await p.click('[data-nd-svc="pare-brise"]'); await p.waitForTimeout(250);
  await p.fill('#f-plaque', 'hk382ml'); await p.press('#f-plaque', 'Tab'); await p.waitForTimeout(500);
  const hint = await p.textContent('#vehHint');
  ok('formulaire : phrase Metabase « ' + hint + ' »', /Metabase : Opel Vivaro · 5 m³ · Saint-Cloud/.test(hint));
  ok('formulaire : modèle Opel Vivaro choisi', (await p.inputValue('#f-base')) === 'Opel Vivaro');
  ok('formulaire : site Saint-Cloud rempli', (await p.inputValue('#f-site')) === 'Saint-Cloud');
  await p.locator('#vehHint').scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/plaque-metabase-telephone.png` });
  ok('aucune erreur de page', !errors.length); if (errors.length) console.log(errors.join('\n'));
  await b.close(); srv.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
