// Page « Contrôles hayon » de l'équipe façon iPhone : captures (téléphone clair / sombre, ordinateur) et vrai parcours
// (fiche en feuille, filtre par compteur, « pas fait » puis « Annuler », coller la liste, retirer, demander un contrôle),
// dans les émulateurs Firebase (aucune donnée réelle).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/hayon.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-hayon');
const BEFORE = process.argv[3] === 'avant'; // seulement les captures de l'ancienne page
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
  await put('config/reglages', { prestataires: ['Khalid', 'DHOLLIANDA'], sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' }, { nom: 'Gennevilliers', adresse: '12 rue du Port' }], flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  await put('prestataires/khalid', { nom: 'Khalid', interventions: true, tarifs: [] });
  await put('prestataires/dhollianda', { nom: 'DHOLLIANDA', hayon: true, lavage: false, interventions: false, tarifs: [] });
  const H = { 'GA-731-PM': -186, 'FT-219-ZB': -177, 'HB-550-TR': -158, 'GD-108-QA': -152, 'GE-402-LM': -95, 'GF-913-RS': -40, 'GH-482-KL': -12, 'GK-777-AB': null };
  for (const [plaque, n] of Object.entries(H)) await put('hayons/' + plaque.replace(/-/g, ''), { plaque, dernierControle: n == null ? '' : day(n) });
  const base = { prestataire: 'DHOLLIANDA', prestataireId: 'dhollianda', service: 'hayon', modele: 'Renault Master 2023', cubage: 20, site: 'Saint-Cloud', adresse: 'Quai Carnot', debut: '09:00', fin: '12:00' };
  await put('demandes/h1', { ...base, plaque: 'GD-108-QA', date: day(6), debut: '10:00', statut: 'envoyee' });
  await put('demandes/h2', { ...base, plaque: 'GL-310-CD', date: day(-9), statut: 'realisee', site: 'Gennevilliers' });
  await put('demandes/h3', { ...base, plaque: 'HB-550-TR', date: day(9), statut: 'envoyee', site: 'Gennevilliers' });
  await put('demandes/h4', { ...base, plaque: 'HB-550-TR', date: day(12), statut: 'envoyee', site: 'Gennevilliers' });
  // Metabase : un véhicule neuf avec hayon (pas dans la liste) apparaît tout seul ; GA-731-PM est déjà dans la liste.
  await put('metabase/flotte', { majLe: new Date().toISOString(), nb: 3, donnees: JSON.stringify({
    HN587SX: ['DAILY - H', '20HM3', 'La Def', day(-1)], GA731PM: ['MAST - H', '20HM3', 'Saint-Cloud', day(-1)], GM100AB: ['MOV - 12', '12M3', 'Aulnay', day(-1)],
    // État (Fabian 25/11) : GK-777-AB est dans la liste mais inactif (sorti de la flotte) ; HN-999-ZZ inactif et pas dans la liste.
    GK777AB: ['MOV - H', '20HM3', '', day(-1), '', 'I'], HN999ZZ: ['DAILY - H', '20HM3', '', day(-1), '', 'I'], HN588SX: ['DAILY - H', '20HM3', 'Aulnay', day(-1), '', 'P'] }) });
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
    await p.goto('http://localhost:8765/'); await p.waitForSelector('#login input');
    await p.fill('#login input[type=email]', 'fabian@city-drop.com'); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
    await p.waitForTimeout(2000);
    await p.evaluate(() => { location.hash = 'hayon'; }); await p.waitForTimeout(900);
    return { p, ctx };
  }
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const pre = BEFORE ? 'avant-' : '';
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open({ ...phone, colorScheme: scheme });
    const s = (n, full) => p.screenshot({ path: `${OUT}/${pre}${scheme}-${n}.png`, fullPage: !!full });
    await s('1-hayon'); await s('1-hayon-long', true);
    if (!BEFORE) {
      await p.click('[data-hy-key="GA731PM"]'); await p.waitForTimeout(700); await s('2-fiche-depasse');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      await p.click('[data-hy-key="HB550TR"]'); await p.waitForTimeout(700); await s('3-fiche-rdv-double');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      await p.click('[data-hy-filter="orange"]'); await p.waitForTimeout(400); await s('4-filtre-bientot');
      await p.click('.hy-tile[data-hy-filter="orange"]'); await p.waitForTimeout(300);
      await p.click('#hy-paste-open'); await p.waitForTimeout(700);
      await p.fill('#hy-paste', 'GM-640-EF\t03/06/2026\nGN-205-XY\t28/05/2026'); await p.waitForTimeout(300); await s('5-coller-liste');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const s = (n, full) => p.screenshot({ path: `${OUT}/${pre}ordi-${n}.png`, fullPage: !!full });
    await s('1-hayon'); await s('1-hayon-long', true);
    if (!BEFORE) {
      // « Pas fait » sur le contrôle d'il y a 9 jours, puis « Annuler »
      await p.click('[data-hy-key="GL310CD"]'); await p.waitForTimeout(700); await s('2-fiche-a-jour');
      await p.click('[data-hy-act="notdone"]'); await p.waitForTimeout(900); await s('3-pas-fait');
      let doc = await get('demandes/h2');
      if (doc.fields?.statut?.stringValue !== 'annulee' || doc.fields?.nonFait?.booleanValue !== true) errors.push('Pas fait non enregistré');
      await p.click('#toast .toast-action'); await p.waitForTimeout(900);
      doc = await get('demandes/h2');
      if (doc.fields?.statut?.stringValue !== 'realisee' || doc.fields?.nonFait?.booleanValue) errors.push('Annuler (pas fait) non enregistré');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      // Coller la liste
      await p.click('#hy-paste-open'); await p.waitForTimeout(600);
      // Ligne entière du tableau de Maëva (mise en circulation, dernier contrôle, prochain) : c'est le dernier contrôle qui compte.
      await p.fill('#hy-paste', 'GM640EF\tCITYDROP\t\t18/04/2024\t*MOV - H\t\t03/06/2026\t03/12/2026\t10\nGN-205-XY\t28/05/2026'); await p.waitForTimeout(200); await s('4-coller-liste');
      await p.click('#hy-import'); await p.waitForTimeout(900);
      doc = await get('hayons/GM640EF');
      if (doc.fields?.dernierControle?.stringValue !== '2026-06-03') errors.push('Liste collée non enregistrée');
      // Véhicule neuf venu de Metabase : dans « À programmer », date inconnue, rien d'écrit dans la liste
      const mbCard = await p.textContent('[data-hy-key="HN587SX"]').catch(() => '');
      if (!/Nouveau dans Metabase/.test(mbCard || '')) errors.push('Véhicule Metabase absent : ' + mbCard);
      if (await p.$('[data-hy-key="GM100AB"]')) errors.push('Véhicule sans hayon affiché');
      if (await p.$('[data-hy-key="HN999ZZ"]')) errors.push('Véhicule inactif ajouté');
      if (!/En panne dans Metabase/.test(await p.textContent('[data-hy-key="HN588SX"]').catch(() => ''))) errors.push('Véhicule en panne absent');
      const groups = await p.$$eval('.hy-gh', (h) => h.map((x) => x.textContent));
      if (!groups.some((g) => /Sortis de la flotte\s*1/.test(g))) errors.push('Groupe « Sortis de la flotte » absent : ' + groups.join(' | '));
      await s('4a-sortis-flotte', true);
      await p.click('[data-hy-key="HN587SX"]'); await p.waitForTimeout(600); await s('4b-fiche-metabase');
      if (!(await p.textContent('.team-sheet')).includes('Metabase indique un hayon')) errors.push('Fiche Metabase sans explication');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      // Retirer (2 appuis)
      await p.click('[data-hy-key="GN205XY"]'); await p.waitForTimeout(600);
      await p.click('[data-hy-act="remove"]'); await p.waitForTimeout(200); await s('5-retirer-confirmer');
      await p.click('[data-hy-act="remove"]'); await p.waitForTimeout(900);
      doc = await get('hayons/GN205XY');
      if (!doc.error) errors.push('Retirer non enregistré');
      // Demander un contrôle : Nouvelle demande remplie
      await p.click('[data-hy-key="GA731PM"]'); await p.waitForTimeout(600); await s('6-fiche-depasse');
      await p.click('[data-hy-act="ask"]'); await p.waitForTimeout(700); await s('7-demande-remplie');
      const f = await p.evaluate(() => ({ plaque: document.querySelector('#f-plaque').value, prest: document.querySelector('#f-prest').value, svc: document.querySelector('input[name="svc"]:checked')?.value }));
      if (f.plaque !== 'GA-731-PM' || f.prest !== 'DHOLLIANDA' || f.svc !== 'hayon') errors.push('Demande pas remplie : ' + JSON.stringify(f));
    }
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(errors.length ? 'ERREURS :\n' + errors.join('\n') : 'OK : aucune erreur');
  process.exit(errors.length ? 1 : 0);
})();
