// Captures de l'écran prestataire « Aujourd'hui » (téléphone clair/sombre + ordinateur) et des feuilles d'action
// (OK prestation réalisée, Reporter, Véhicule absent), dans les émulateurs Firebase (aucune donnée réelle).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/aujourdhui.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-aujourdhui');
const BEFORE = process.argv[3] === 'avant'; // ancien écran : seulement les captures de l'onglet
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

const base = { prestataire: 'Khalid', prestataireId: 'khalid', statut: 'confirmee' };
async function seed() {
  await put('comptes/khalid@lavage.fr', { role: 'prestataire', prestataireId: 'khalid', email: 'khalid@lavage.fr' });
  await put('config/reglages', { prestataires: ['Khalid'], sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' }, { nom: 'Aulnay', adresse: '12 rue de la Croix Blanche, 93600 Aulnay-sous-Bois' }], flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  await put('prestataires/khalid', { nom: 'Khalid', interventions: true, lavage: true, tarifs: [{ service: 'lavage', cubageMin: null, cubageMax: null, prixHT: 37 }] });
  const sc = { site: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' };
  const au = { site: 'Aulnay', adresse: '12 rue de la Croix Blanche, 93600 Aulnay-sous-Bois' };
  await put('demandes/t1', { ...base, ...sc, service: 'lavage', plaque: 'GA-731-PM', modele: 'Renault Master 2023', cubage: 20, date: day(0), debut: '09:00', fin: '12:00', prixHT: 37 });
  await put('demandes/t2', { ...base, ...sc, service: 'lavage', plaque: 'FK-402-ZD', modele: 'Peugeot Boxer', cubage: 12, date: day(0), debut: '09:00', fin: '12:00', prixHT: 37, notes: 'Clés à l\'accueil, demander Karim' });
  await put('demandes/t3', { ...base, ...au, service: 'intervention', plaque: 'HD-118-QS', modele: 'Renault Trafic', cubage: 6, date: day(-2), dateFin: day(1), debut: '08:00', fin: '18:00', tache: 'Changer l\'ampoule du feu arrière gauche' });
  await put('demandes/t4', { ...base, ...au, service: 'lavage', plaque: 'EZ-655-LM', modele: 'Citroën Jumper', cubage: 17, date: day(-3), debut: '14:00', fin: '17:00', prixHT: 42 });
  await put('demandes/v1', { prestataire: 'Khalid', prestataireId: 'khalid', statut: 'envoyee', ...sc, service: 'lavage', plaque: 'GT-910-AB', modele: 'Renault Master 2023', cubage: 20, date: day(2), debut: '09:00', fin: '12:00' });
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
    await p.goto('http://localhost:8765/'); await p.waitForSelector('#login input');
    await p.fill('#login input[type=email]', email); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
    await p.waitForTimeout(1800);
    await p.click('[data-tab="today"]'); await p.waitForTimeout(400);
    return { p, ctx };
  }
  const phone = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const desk = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 };
  const pre = BEFORE ? 'avant-' : '';
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open('khalid@lavage.fr', { ...phone, colorScheme: scheme });
    await p.screenshot({ path: `${OUT}/${pre}${scheme}-1-aujourdhui.png` });
    await p.screenshot({ path: `${OUT}/${pre}${scheme}-1-aujourdhui-long.png`, fullPage: true });
    if (!BEFORE) {
      await p.click('[data-act="done"][data-id="t1"]'); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/${scheme}-2-feuille-ok.png` });
      await p.click('.sheet-x'); await p.waitForTimeout(500);
      await p.click('[data-act="date"][data-id="t3"]'); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/${scheme}-3-feuille-reporter.png` });
      await p.click('.sheet-x'); await p.waitForTimeout(500);
      await p.click('[data-act="absent"][data-id="t4"]'); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/${scheme}-4-feuille-absent.png` });
      await p.click('.sheet-x'); await p.waitForTimeout(500);
      if (scheme === 'light') { // la coche verte sur la carte, puis la bulle avec « Corriger »
        await p.click('[data-act="done"][data-id="t2"]'); await p.waitForTimeout(600); await p.click('[data-asend]');
        await p.waitForTimeout(330); await p.screenshot({ path: `${OUT}/light-5-coche-ok.png` });
        await p.waitForTimeout(1400); await p.screenshot({ path: `${OUT}/light-6-bulle-corriger.png` });
        await p.click('.toast-action'); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/light-7-corriger.png` });
        if (!(await p.$('[data-asheet]'))) errors.push('« Corriger » de la bulle n\'ouvre pas la feuille');
        await p.click('.sheet-x'); await p.waitForTimeout(400);
      }
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open('khalid@lavage.fr', desk);
    await p.screenshot({ path: `${OUT}/${pre}ordi-1-aujourdhui.png` });
    if (!BEFORE) {
      await p.click('[data-act="done"][data-id="t1"]'); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/ordi-2-feuille-ok.png` });
      // Parcours réel : confirmer, vérifier l'écriture, puis Corriger.
      await p.fill('[data-asheet] [data-note]', 'RAS'); await p.click('[data-asend]'); await p.waitForTimeout(1600);
      const doc = await get('demandes/t1');
      if (doc.fields?.retour?.mapValue?.fields?.etat?.stringValue !== 'fait') errors.push('OK réalisée non enregistré : ' + JSON.stringify(doc.fields?.retour));
      await p.screenshot({ path: `${OUT}/ordi-5-apres-ok.png` });
      await p.click('[data-act="date"][data-id="t3"]'); await p.waitForTimeout(500);
      await p.fill('[data-asheet] [data-date]', day(3)); await p.click('[data-asend]'); await p.waitForTimeout(1500);
      const d3 = await get('demandes/t3');
      if (d3.fields?.retour?.mapValue?.fields?.etat?.stringValue !== 'autre-date') errors.push('Reporter non enregistré');
      await p.click('[data-act="absent"][data-id="t4"]'); await p.waitForTimeout(500); await p.click('[data-asend]'); await p.waitForTimeout(1500);
      const d4 = await get('demandes/t4');
      if (d4.fields?.retour?.mapValue?.fields?.etat?.stringValue !== 'absent') errors.push('Absent non enregistré');
      await p.screenshot({ path: `${OUT}/ordi-6-apres-actions.png` });
    }
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
