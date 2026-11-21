// Captures et petite vidéo de la feuille « Signaler » (icônes en volume, rebond, voyant qui s'allume, coche après envoi),
// et des Retours côté équipe, dans les émulateurs Firebase (aucune donnée réelle).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/signaler-icones.e2e.js <dossier>"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-signaler');
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
const at = (n, hm) => `${day(n)}T${hm}:00.000Z`;

async function seed() {
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('comptes/khalid@lavage.fr', { role: 'prestataire', prestataireId: 'khalid', email: 'khalid@lavage.fr' });
  await put('config/reglages', { prestataires: ['Khalid'], sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' }], flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  await put('prestataires/khalid', { nom: 'Khalid', interventions: true, tarifs: [{ service: 'lavage', cubageMin: null, cubageMax: null, prixHT: 37 }] });
  await put('demandes/r1', { prestataire: 'Khalid', prestataireId: 'khalid', service: 'lavage', plaque: 'GA-731-PM', modele: 'Renault Master 2023', cubage: 20, site: 'Saint-Cloud', adresse: 'Quai Carnot', date: day(0), debut: '09:00', fin: '12:00', statut: 'confirmee', prixHT: 37 });
  await put('signalements/f1', { demandeId: '', source: 'terrain', plaque: 'FT-219-ZB', prestataireId: 'khalid', type: 'autre', quoi: ['Pneu avant', 'Carrosserie'], texte: 'Pneu avant, Carrosserie – rayure porte latérale', statut: 'nouveau', at: at(0, '08:42'), par: 'khalid@lavage.fr' });
  await put('signalements/f2', { demandeId: '', source: 'terrain', plaque: 'HB-550-TR', prestataireId: 'khalid', type: 'autre', quoi: ['Véhicule sale'], texte: 'Véhicule sale', statut: 'traite', at: at(-1, '16:10'), par: 'khalid@lavage.fr', traiteAt: at(-1, '17:00'), traitePar: 'fabian@city-drop.com' });
  await signUp('fabian@city-drop.com'); await signUp('khalid@lavage.fr');
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
    await p.goto('http://localhost:8765/'); await p.waitForSelector('#login input');
    await p.fill('#login input[type=email]', email); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
    await p.waitForTimeout(1800);
    return { p, ctx };
  }
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  // 1. Le parcours complet, filmé.
  {
    const { p, ctx } = await open('khalid@lavage.fr', { ...phone, deviceScaleFactor: 1, recordVideo: { dir: OUT + '/video', size: { width: 390, height: 844 } } });
    await p.click('[data-sheet-open]'); await p.waitForTimeout(900);
    const sendGrey = await p.getAttribute('[data-fsend]', 'aria-disabled');
    if (sendGrey !== 'true') errors.push('bouton Transmettre pas grisé au départ');
    await p.click('[data-fplate]'); await p.keyboard.type('GH482KL', { delay: 90 }); await p.waitForTimeout(400);
    for (const q of ['Pare-brise', 'Voyant allumé', 'Rétro cassé']) { await p.click(`[data-fissue][data-q="${q}"]`); await p.waitForTimeout(800); }
    if (await p.getAttribute('[data-fsend]', 'aria-disabled') !== 'false') errors.push('bouton Transmettre encore grisé');
    await p.click('[data-fsend]'); await p.waitForTimeout(2600);
    await p.evaluate(() => document.querySelector('.sheet-b').scrollTo({ top: 9999, behavior: 'smooth' })); await p.waitForTimeout(1500);
    await ctx.close();
  }
  // 2. Captures nettes, clair puis sombre.
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open('khalid@lavage.fr', { ...phone, colorScheme: scheme });
    const s = (n) => p.screenshot({ path: `${OUT}/${scheme}-${n}.png` });
    await p.click('[data-sheet-open]'); await p.waitForTimeout(700); await s('1-feuille-vide');
    await p.fill('[data-fplate]', 'GH-482-KL');
    await p.click('[data-fissue][data-q="Pare-brise"]'); await p.waitForTimeout(400);
    await p.click('[data-fissue][data-q="Voyant allumé"]'); await p.waitForTimeout(90); await s('2-rebond');
    await p.waitForTimeout(500); await s('3-deux-choix');
    await p.click('[data-fsend]'); await p.waitForTimeout(450); await s('4-coche-envoi');
    await p.waitForTimeout(1800);
    await p.evaluate(() => document.querySelector('.sheet-b').scrollTo({ top: 9999 })); await p.waitForTimeout(300); await s('5-signalements-recents');
    await ctx.close();
  }
  // 3. Côté équipe : les Retours avec les petites icônes.
  {
    const { p, ctx } = await open('fabian@city-drop.com', { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    await p.evaluate(() => { location.hash = 'retours'; }); await p.waitForTimeout(800);
    const el = await p.$('#problemsBlock');
    if (el) await el.screenshot({ path: `${OUT}/6-retours-equipe.png` }); else errors.push('pas de bloc problèmes');
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
