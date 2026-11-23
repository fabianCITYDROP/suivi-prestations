// « Valider le lavage » (23/11/2026) : un « Véhicule sale » signalé en passant devient un lavage accepté en un geste.
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/valider-lavage.e2e.js <dossier>"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-valider-lavage');
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
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const at = (n, hm) => `${day(n)}T${hm}:00.000Z`;
// Une photo d'exemple (dessinée, pas une vraie photo) : 640×480 JPEG.
const PHOTO = (() => {
  const f = path.join(__dirname, 'exemple-photo.b64');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '';
})();

async function seed() {
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('comptes/dsat@x.fr', { role: 'prestataire', prestataireId: 'du-sol-au-toit', email: 'dsat@x.fr' });
  await put('config/reglages', { prestataires: ['Du Sol au Toit', 'Khalid', 'DHOLLIANDA'], sites: [{ nom: 'La Défense', adresse: '1 parvis de La Défense' }, { nom: 'Saint-Cloud', adresse: 'Quai Carnot' }],
    flotte: [{ modele: 'Renault Master 2023', cubage: 20 }, { modele: 'Peugeot Expert', cubage: 6 }] });
  await put('prestataires/du-sol-au-toit', { nom: 'Du Sol au Toit', lavage: true, tarifs: [{ service: 'lavage', formule: 'complet', prixHT: 42 }, { service: 'lavage', formule: 'interieur', prixHT: 25 }] });
  await put('prestataires/khalid', { nom: 'Khalid', interventions: true, tarifs: [] });
  await put('prestataires/dhollianda', { nom: 'DHOLLIANDA', hayon: true, tarifs: [] });
  await put('vehicules/GS487PR', { plaque: 'GS-487-PR', modele: 'Renault Master 2023', cubage: 20, site: 'La Défense', photos: [] });
  await put('demandes/old1', { plaque: 'GS-487-PR', service: 'lavage', prestataire: 'Du Sol au Toit', prestataireId: 'du-sol-au-toit', site: 'La Défense', date: day(-6), debut: '09:00', fin: '12:00', statut: 'realisee', modele: 'Renault Master 2023', cubage: 20 });
  await put('signalements/f1', { demandeId: '', source: 'terrain', plaque: 'GS-487-PR', prestataireId: 'du-sol-au-toit', type: 'autre', quoi: ['Véhicule sale'], texte: 'Véhicule sale – boue sur tout le côté', statut: 'nouveau', at: at(0, '07:31'), par: 'dsat@x.fr' });
  await put('signalements/f2', { demandeId: '', source: 'terrain', plaque: 'GN-205-XY', prestataireId: 'khalid', type: 'autre', quoi: ['Voyant allumé'], texte: 'Voyant allumé', statut: 'nouveau', at: at(0, '07:20'), par: 'khalid@x.fr' });
  await put('signalements/f3', { demandeId: '', source: 'terrain', plaque: 'HB-550-TR', prestataireId: 'dhollianda', type: 'autre', quoi: ['Véhicule sale'], texte: 'Véhicule sale', statut: 'nouveau', at: at(0, '07:10'), par: 'dho@x.fr' });
  await signUp('fabian@city-drop.com'); await signUp('dsat@x.fr');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await seed();
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8765);
  const b = await chromium.launch();
  const errors = [];
  async function open(opts, email, hash) {
    const ctx = await b.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', ...opts });
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
    await p.fill('#login input[type=email]', email); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
    await p.waitForTimeout(2200);
    if (hash) { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(900); }
    return { p, ctx };
  }
  const TEL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const ORDI = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
  for (const [name, opts] of [['tel', TEL], ['ordi', ORDI]]) {
    const { p, ctx } = await open({ ...opts, colorScheme: 'light' }, 'fabian@city-drop.com', 'retours');
    const s = (n) => p.screenshot({ path: `${OUT}/${name}-${n}.png` });
    await s('1-retours');
    const washBtns = await p.$$eval('#retList [data-ret-act="wash"]', (l) => l.map((x) => x.dataset.key));
    if (JSON.stringify(washBtns) !== '["f:f1"]') errors.push(name + ' : bouton Valider le lavage attendu seulement sur f1, vu ' + JSON.stringify(washBtns));
    if (name === 'tel') { await ctx.close(); continue; }
    await p.click('.ret-card[data-ret="f:f1"] [data-ret-act="wash"]'); await p.waitForTimeout(700); await s('2-valider');
    const price = await p.textContent('.wash-sheet [data-wash-price]');
    if (!/42/.test(price)) errors.push('prix complet attendu 42 €, vu ' + price);
    if (!(await p.textContent('.wash-sheet')).includes('La Défense')) errors.push('site de la dernière demande attendu');
    await p.click('.wash-sheet input[name="washKind"][value="interieur"] + span'); await p.waitForTimeout(200);
    const price2 = await p.textContent('.wash-sheet [data-wash-price]');
    if (!/25/.test(price2)) errors.push('prix intérieur attendu 25 €, vu ' + price2);
    await p.click('.wash-sheet input[name="washKind"][value="complet"] + span');
    await p.click('.wash-sheet [data-ret-act="wash-ok"]'); await p.waitForTimeout(1500); await s('3-apres');
    const rep = await get('signalements/f1');
    if (rep.fields?.statut?.stringValue !== 'traite') errors.push('signalement f1 pas rangé');
    const list = await fetch(`${FS}/demandes`, { headers: owner }).then((r) => r.json());
    const docs = (list.documents || []).filter((d) => d.fields?.signalementId?.stringValue === 'f1');
    if (docs.length !== 1) errors.push('une demande attendue, vu ' + docs.length);
    else {
      const f = docs[0].fields;
      const want = { site: 'La Défense', statut: 'confirmee', service: 'lavage', prestataireId: 'du-sol-au-toit', plaque: 'GS-487-PR', date: day(0), prestataire: 'Du Sol au Toit' };
      for (const [k, v] of Object.entries(want)) if (f[k]?.stringValue !== v) errors.push(`demande.${k} = ${JSON.stringify(f[k])}, attendu ${v}`);
      if (+(f.prixHT?.integerValue ?? f.prixHT?.doubleValue) !== 42) errors.push('prixHT ' + JSON.stringify(f.prixHT));
    }
    await ctx.close();
  }
  // Côté prestataire : le lavage est dans « Aujourd'hui », le signalement dit « Lavage validé ».
  const { p, ctx } = await open({ ...TEL, colorScheme: 'light' }, 'dsat@x.fr');
  await p.screenshot({ path: `${OUT}/tel-4-prestataire-aujourdhui.png` });
  const body = await p.textContent('body');
  if (!body.includes('GS-487-PR')) errors.push('le prestataire ne voit pas le lavage');
  const plus = await p.$('.tab-plus');
  if (plus) { await plus.click(); await p.waitForTimeout(900); await p.screenshot({ path: `${OUT}/tel-5-prestataire-signaler.png` }); }
  const pills = await p.$$eval('.seen-pill', (l) => l.map((x) => x.textContent));
  if (!pills.includes('Lavage validé')) errors.push('pastille « Lavage validé » absente : ' + JSON.stringify(pills));
  await ctx.close();
  await b.close(); srv.close();
  if (errors.length) { console.log('ERREURS', errors); process.exit(1); }
  console.log('OK valider lavage');
})().catch((e) => { console.error(e); process.exit(1); });
