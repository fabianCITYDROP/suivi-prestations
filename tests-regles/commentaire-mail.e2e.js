// Captures : le « Commentaire : » d'un mail City-Drop sur la fiche du prestataire (À valider) et de l'équipe (Planning).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/commentaire-mail.e2e.js <dossier>"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const M = require('../apps-script/import-mails.js');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-commentaire');
const FS = 'http://127.0.0.1:8080/v1/projects/suivi-prestations/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v }
  : { stringValue: String(v) };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(obj).map(([k, x]) => [k, val(x)])) }) })
  .then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); });
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then((r) => r.json());
const fr = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); };

const mail = (plaque, lignes, commentaire, h = '09:00') => `<p>Nous souhaitons une intervention sur notre <b>M20H-DVL</b> entre le <b>${fr(1)} ${h}</b> et le <b>${fr(1)} 12:00</b>.</p>
<p>Le véhicule est immatriculé : <b>${plaque}</b> (119570 KM).</p><p>Nous souhaitons une intervention pour :<br/>${lignes.map((l) => '- ' + l + '<br/>').join('')}</p>
${commentaire === null ? '' : `<p>Commentaire : ${commentaire}</p>`}<p>Nom du garage : Khalid Lavage</p><p>Nous vous remercions par avance !</p>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await put('comptes/khalid@lavage.fr', { role: 'prestataire', prestataireId: 'khalid', email: 'khalid@lavage.fr' });
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('prestataires/khalid', { nom: 'Khalid', interventions: true, lavage: true });
  await fetch(`${FS}/config/reglages`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: {
    prestataires: { arrayValue: { values: [{ stringValue: 'Khalid' }] } },
    sites: { arrayValue: { values: [{ mapValue: { fields: { nom: { stringValue: 'Saint-Cloud' }, adresse: { stringValue: 'Quai Carnot, 92210 Saint-Cloud' } } } }] } } } }) });
  const lus = [
    M.lireMail('Prise de rendez-vous GS-487-PR', mail('GS-487-PR', ['Lavage extérieur', 'Lavage intérieur', 'Diag'], 'Voyant moteur allumé depuis hier,<br/>merci de regarder et de nous dire ce que c&#39;est', '08:00')),
    M.lireMail('Prise de rendez-vous FK-402-ZD', mail('FK-402-ZD', ['Lavage extérieur', 'Lavage intérieur'], null)),
  ];
  for (const d of lus) await put('demandes/' + M.idDemande(d), { ...d, prestataire: 'Khalid', prestataireId: 'khalid', site: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud', modele: 'Renault Master 2023', cubage: 20, sentAt: new Date().toISOString(), createdAt: new Date().toISOString() });
  console.log('commentaire lu :', lus[0].notes, '| sans commentaire :', 'notes' in lus[1]);
  await signUp('khalid@lavage.fr'); await signUp('fabian@city-drop.com');
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8771);
  const b = await chromium.launch();
  const errors = [];
  async function open(email, opts, hash = '') {
    const ctx = await b.newContext(opts); const p = await ctx.newPage();
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
    await p.goto('http://localhost:8771/' + hash); await p.waitForSelector('#login input');
    await p.fill('#login input[type=email]', email); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
    await p.waitForTimeout(2000);
    return { p, ctx };
  }
  const phone = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  for (const scheme of ['light', 'dark']) {
    const k = await open('khalid@lavage.fr', { ...phone, colorScheme: scheme });
    await k.p.click('[data-tab="validate"]'); await k.p.waitForTimeout(500);
    await k.p.evaluate(() => window.scrollTo(0, 120)); await k.p.waitForTimeout(300);
    await k.p.screenshot({ path: `${OUT}/${scheme}-1-prestataire-a-valider.png` });
    await k.ctx.close();
  }
  const t = await open('fabian@city-drop.com', { ...phone, colorScheme: 'light' }, '#planning');
  await t.p.waitForTimeout(800);
  const d = t.p.locator('[data-day]').filter({ hasText: String(new Date(Date.now() + 864e5).getDate()) }).last(); if (await d.count()) { await d.click(); await t.p.waitForTimeout(600); }
  await t.p.screenshot({ path: `${OUT}/light-2-equipe-planning.png` });
  const card = t.p.locator(`[data-open="${M.idDemande(lus[0])}"]`);
  if (await card.count()) { await card.first().click(); await t.p.waitForTimeout(700); await t.p.screenshot({ path: `${OUT}/light-3-equipe-fiche.png` }); }
  else errors.push('carte équipe introuvable');
  await t.ctx.close();
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
