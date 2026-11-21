// Page « Bilan » de l'équipe façon iPhone : captures (téléphone clair / sombre, ordinateur) et parcours
// (mois en contrôle segmenté, « Autre mois », pastilles prestataire, feuille « Détail pour la facture », feuille « Exporter »),
// dans les émulateurs Firebase (aucune donnée réelle). Les prix sont des exemples.
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/bilan.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-bilan');
const BEFORE = process.argv[3] === 'avant'; // seulement les captures de l'ancienne page
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
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date(); const TODAY = iso(now);
const inMonth = (offset, dayN) => iso(new Date(now.getFullYear(), now.getMonth() + offset, dayN));

async function seed() {
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  const P = { khalid: 'Khalid', allo: 'Allo Pare-Brise', gael: 'Gaël', roig: 'Roig', dsat: 'Du Sol au Toit', dhol: 'DHOLLIANDA' };
  await put('config/reglages', { prestataires: Object.values(P), sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot' }, { nom: 'Gennevilliers', adresse: '12 rue du Port' }, { nom: 'Bordeaux Lac', adresse: 'Av. des 40 Journaux' }, { nom: 'Wissous', adresse: 'Rue de l\'Industrie' }],
    flotte: [{ modele: 'Renault Master 2023', cubage: 20 }, { modele: 'Peugeot Expert', cubage: 6 }, { modele: 'Iveco Daily', cubage: 12 }] });
  for (const [id, nom] of Object.entries(P)) await put('prestataires/' + id, { nom, interventions: id !== 'dsat', tarifs: [] });
  const models = [['Renault Master 2023', 20], ['Peugeot Expert', 6], ['Iveco Daily', 12]];
  const sites = ['Saint-Cloud', 'Gennevilliers', 'Wissous'];
  // Lignes : [prestataire, service, formule, prix HT, combien]
  const plan = [
    ['Khalid', 'lavage', 'complet', 37, 22], ['Khalid', 'lavage', 'interieur', 25, 6], ['Khalid', 'intervention', '', 45, 3],
    ['Du Sol au Toit', 'lavage', 'complet', 42, 18],
    ['Gaël', 'lavage', 'complet', 37, 9],
    ['Allo Pare-Brise', 'pare-brise', '', 360, 4], ['Allo Pare-Brise', 'pare-brise', '', 320, 2], ['Allo Pare-Brise', 'lavage', 'interieur', 25, 3],
    ['Roig', 'intervention', '', 60, 5], ['Roig', 'intervention', '', null, 1],
    ['DHOLLIANDA', 'hayon', '', null, 6],
  ];
  const lastDone = Math.max(1, now.getDate() - 1);
  let n = 0, plateN = 100;
  for (const [prov, service, formule, prix, count] of plan) {
    for (let i = 0; i < count; i++) {
      n++;
      const dayN = 1 + ((n * 7 + i * 3) % 28);
      const date = inMonth(0, dayN);
      const [modele, cubage] = models[n % 3];
      let statut = date < TODAY ? 'realisee' : 'confirmee';
      if (n % 17 === 0) statut = 'annulee';
      else if (date < TODAY && n % 9 === 0) statut = 'envoyee'; // dispo passée, pas encore réalisée
      const site = prov === 'Gaël' ? 'Bordeaux Lac' : sites[n % 3];
      const plaque = `G${String.fromCharCode(65 + (n % 26))}-${plateN++}-${String.fromCharCode(65 + ((n * 3) % 26))}${String.fromCharCode(66 + ((n * 5) % 24))}`;
      await put('demandes/b' + n, { prestataire: prov, prestataireId: Object.keys(P).find((k) => P[k] === prov), service, ...(formule ? { formule } : {}),
        ...(service === 'intervention' ? { tache: i % 2 ? 'Changer le rétroviseur' : 'Remplacer un feu arrière' } : {}),
        plaque, modele, cubage, site, adresse: '', date, debut: '09:00', fin: '12:00', statut, prixHT: prix,
        ...(statut === 'realisee' ? { doneAt: `${date}T15:00:00.000Z` } : {}) });
    }
  }
  // Le mois d'avant, pour « Autre mois »
  for (let i = 1; i <= 12; i++) await put('demandes/p' + i, { prestataire: i % 2 ? 'Khalid' : 'Du Sol au Toit', prestataireId: i % 2 ? 'khalid' : 'dsat', service: 'lavage', formule: 'complet',
    plaque: `FP-${200 + i}-ZZ`, modele: 'Renault Master 2023', cubage: 20, site: 'Saint-Cloud', adresse: '', date: inMonth(-1, 2 * i), debut: '09:00', fin: '12:00', statut: 'realisee', prixHT: i % 2 ? 37 : 42 });
  await signUp('fabian@city-drop.com');
  void lastDone;
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
    await p.evaluate(() => { location.hash = 'bilan'; }); await p.waitForTimeout(1500);
    return { p, ctx };
  }
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const pre = BEFORE ? 'avant-' : '';
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open({ ...phone, colorScheme: scheme });
    const s = (n, full) => p.screenshot({ path: `${OUT}/${pre}${scheme}-${n}.png`, fullPage: !!full });
    await s('1-bilan'); await s('1-bilan-long', true);
    if (!BEFORE) {
      await p.click('.bil-prov-row[data-bil-prov="Khalid"]'); await p.waitForTimeout(700); await s('2-facture-khalid');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      await p.click('.bil-prov-row[data-bil-prov="DHOLLIANDA"]'); await p.waitForTimeout(700); await s('3-facture-forfait');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      await p.click('[data-bil-export]'); await p.waitForTimeout(700); await s('4-exporter');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      await p.click('[data-bil-pick-month]'); await p.waitForTimeout(700); await s('5-autre-mois');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      await p.click('.bil-provs [data-bil-filter="Du Sol au Toit"]'); await p.waitForTimeout(600); await s('6-un-prestataire');
      await p.click('.bil-provs [data-bil-filter=""]'); await p.waitForTimeout(400);
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const s = (n, full) => p.screenshot({ path: `${OUT}/${pre}ordi-${n}.png`, fullPage: !!full });
    await s('1-bilan'); await s('1-bilan-long', true);
    if (!BEFORE) {
      await p.click('.bil-prov-row[data-bil-prov="Allo Pare-Brise"]'); await p.waitForTimeout(700); await s('2-facture-allo');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      // Mois d'avant par le contrôle segmenté : le total change
      const before = await p.textContent('.bil-total-n');
      await p.click('.bil-months [data-bil-month]:nth-child(2)'); await p.waitForTimeout(1500);
      const after = await p.textContent('.bil-total-n');
      if (before === after) errors.push('Le mois d\'avant ne change pas le total');
      await s('3-mois-avant');
      if (!/474/.test(after.replace(/\s/g, ''))) errors.push('Total du mois d\'avant inattendu : ' + after);
      await p.click('.bil-months [data-bil-month]:nth-child(3)'); await p.waitForTimeout(800);
      // Une ligne ouvre la fiche du véhicule
      await p.click('.bil-row[data-open]'); await p.waitForTimeout(700); await s('4-fiche-vehicule');
    }
    await ctx.close();
  }
  await b.close(); srv.close();
  if (errors.length) { console.log('ERREURS', errors); process.exit(1); }
  console.log('OK bilan');
})().catch((e) => { console.error(e); process.exit(1); });
