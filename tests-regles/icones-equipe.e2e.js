// Captures « icônes de l'équipe » (21/11/2026) : Planning, Retours › Déjà traité, Bilan, menu Plus, Réglages, Sites.
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/icones-equipe.e2e.js <dossier> [avant]"
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
  const FL = { khalid: { lavage: true, interventions: true }, allo: { pareBrise: true, interventions: true, lavage: true }, gael: { lavage: true, interventions: true }, roig: { interventions: true, lavage: false }, dsat: { lavage: true, interventions: false }, dhol: { hayon: true, lavage: false, interventions: false } };
  for (const [id, nom] of Object.entries(P)) await put('prestataires/' + id, { nom, ...FL[id], tarifs: [] });
  // Retours déjà vus / traités (onglet « Déjà traité »)
  const at = (hm) => `${TODAY}T${hm}:00.000Z`;
  await put('demandes/r1', { prestataire: 'Khalid', prestataireId: 'khalid', service: 'lavage', formule: 'complet', plaque: 'GL-310-CD', modele: 'Renault Master 2023', cubage: 20, site: 'Saint-Cloud', adresse: '', date: TODAY, debut: '09:00', fin: '12:00', statut: 'realisee', prixHT: 37, retour: { etat: 'fait', at: at('08:02'), par: 'khalid@x.fr', vu: true, applique: true } });
  await put('demandes/r2', { prestataire: 'Gaël', prestataireId: 'gael', service: 'lavage', formule: 'complet', plaque: 'GA-731-PM', modele: 'Renault Master 2023', cubage: 20, site: 'Bordeaux Lac', adresse: '', date: TODAY, debut: '09:00', fin: '12:00', statut: 'confirmee', prixHT: 37, retour: { etat: 'confirme', at: at('07:40'), par: 'gael@x.fr', vu: true, applique: true } });
  await put('signalements/f3', { demandeId: '', source: 'terrain', plaque: 'GP-118-ZZ', prestataireId: 'khalid', type: 'autre', quoi: ['Véhicule sale'], texte: 'Véhicule sale', statut: 'traite', at: at('06:10'), par: 'khalid@x.fr', traiteAt: at('07:00'), traitePar: 'fabian@city-drop.com' });
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
    await p.fill('#login input[type=email]', 'fabian@city-drop.com'); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
    await p.waitForTimeout(2200);
    return { p, ctx };
  }
  const go = async (p, v) => { await p.evaluate((x) => { location.hash = x; }, v); await p.waitForTimeout(1200); };
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const pre = BEFORE ? 'avant-' : '';
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open({ ...phone, colorScheme: scheme });
    const s = (n, full) => p.screenshot({ path: `${OUT}/${pre}${scheme}-${n}.png`, fullPage: !!full });
    await go(p, 'planning'); await s('1-planning');
    await go(p, 'retours'); await s('2-retours');
    await p.click('[data-ret-tab="done"]'); await p.waitForTimeout(600); await s('2-retours-deja-traite');
    await go(p, 'bilan'); await s('3-bilan'); await s('3-bilan-long', true);
    await go(p, 'planning'); await p.click('#navMore summary'); await p.waitForTimeout(800); await s('4-plus');
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    await go(p, 'reglages'); await s('5-reglages'); await s('5-reglages-long', true);
    await p.click('[data-rg-open="sites"]'); await p.waitForTimeout(800); await s('6-sites');
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const s = (n, full) => p.screenshot({ path: `${OUT}/${pre}ordi-${n}.png`, fullPage: !!full });
    await go(p, 'planning'); await p.click('#navMore summary'); await p.waitForTimeout(600); await s('4-plus');
    await p.click('#navMore summary'); await go(p, 'bilan'); await s('3-bilan');
    await go(p, 'reglages'); await s('5-reglages');
    await ctx.close();
  }
  await b.close(); srv.close();
  if (errors.length) { console.log('ERREURS', errors); process.exit(1); }
  console.log('OK icônes équipe');
})().catch((e) => { console.error(e); process.exit(1); });
