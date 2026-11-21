// Captures de la page Planning de l'équipe (téléphone clair/sombre + ordinateur) et parcours de la fiche d'une demande,
// dans les émulateurs Firebase (aucune donnée réelle).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/planning.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-planning');
const BEFORE = process.argv[3] === 'avant';
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
const now = (h) => `${day(0)}T${h}:00.000Z`;

async function seed() {
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('config/reglages', { prestataires: ['ALLO pare-brise 78', 'Du Sol au Toit', 'Khalid'],
    sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' }, { nom: 'Aulnay', adresse: '12 rue de la Croix Blanche, 93600 Aulnay-sous-Bois' }, { nom: 'La Défense', adresse: '5 parvis de la Défense, 92800 Puteaux' }],
    flotte: [{ modele: 'Renault Master 2023', cubage: 20 }, { modele: 'Opel Movano 2024', cubage: 12 }] });
  const allo = { prestataire: 'ALLO pare-brise 78', prestataireId: 'allo-pare-brise-78' };
  const dsat = { prestataire: 'Du Sol au Toit', prestataireId: 'du-sol-au-toit' };
  const kh = { prestataire: 'Khalid', prestataireId: 'khalid' };
  const sc = { site: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' };
  const au = { site: 'Aulnay', adresse: '12 rue de la Croix Blanche, 93600 Aulnay-sous-Bois' };
  const ld = { site: 'La Défense', adresse: '5 parvis de la Défense, 92800 Puteaux' };
  const u = { updatedAt: '2026-01-01T00:00:00Z' };
  await put('demandes/p1', { ...u, ...dsat, ...sc, service: 'lavage', lavage: 'complet', plaque: 'GA-731-PM', modele: 'Renault Master 2023', cubage: 20, date: day(0), debut: '09:00', fin: '12:00', statut: 'realisee', prixHT: 42, retour: { etat: 'fait', at: now('08:42'), vu: false } });
  await put('demandes/p2', { ...u, ...dsat, ...sc, service: 'lavage', plaque: 'FK-402-ZD', modele: 'Opel Movano 2024', cubage: 12, date: day(0), debut: '09:00', fin: '12:00', statut: 'confirmee', prixHT: 37, notes: "Clés à l'accueil" });
  await put('demandes/p3', { ...u, ...allo, ...sc, service: 'pare-brise', plaque: 'HB-220-KL', modele: 'Renault Master 2023', cubage: 20, date: day(0), debut: '13:00', fin: '17:00', statut: 'envoyee', prixHT: 360 });
  await put('demandes/p4', { ...u, ...kh, ...au, service: 'intervention', plaque: 'HD-118-QS', modele: 'Renault Trafic', cubage: 6, date: day(-1), dateFin: day(1), debut: '08:00', fin: '18:00', statut: 'confirmee', tache: "Changer l'ampoule du feu arrière gauche" });
  await put('demandes/p5', { ...u, ...kh, ...au, service: 'lavage', plaque: 'EZ-655-LM', modele: 'Citroën Jumper', cubage: 17, date: day(0), debut: '14:00', fin: '17:00', statut: 'a_envoyer', prixHT: 37 });
  await put('demandes/p6', { ...u, ...dsat, ...ld, service: 'lavage', plaque: 'GT-910-AB', modele: 'Renault Master 2023', cubage: 20, date: day(0), debut: '10:00', fin: '12:00', statut: 'confirmee', prixHT: 42, retour: { etat: 'absent', at: now('09:15'), vu: false } });
  await put('demandes/p7', { ...u, ...kh, ...ld, service: 'intervention', plaque: 'FR-377-TT', modele: 'Opel Movano 2024', cubage: 12, date: day(0), debut: '08:00', fin: '10:00', statut: 'annulee', tache: 'Rétroviseur' });
  await put('demandes/p8', { ...u, ...dsat, ...sc, service: 'lavage', plaque: 'GL-554-XC', modele: 'Renault Master 2023', cubage: 20, date: day(1), debut: '09:00', fin: '12:00', statut: 'envoyee', prixHT: 42 });
  await put('demandes/p9', { ...u, ...allo, ...au, service: 'pare-brise', plaque: 'GV-118-RB', modele: 'Opel Movano 2024', cubage: 12, date: day(2), debut: '09:00', fin: '12:00', statut: 'a_envoyer', prixHT: 320, retour: { etat: 'autre-date', date: day(3), at: now('07:50'), vu: false } });
  await put('signalements/r1', { demandeId: 'p1', plaque: 'GA-731-PM', prestataireId: 'du-sol-au-toit', type: 'autre', quoi: ['Pneu avant'], texte: 'Pneu avant droit à plat', statut: 'nouveau', at: now('08:40'), par: 'dsat@test.fr' });
  await signUp('fabian@city-drop.com');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await seed();
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8767);
  const b = await chromium.launch();
  const errors = [];
  async function open(opts) {
    const ctx = await b.newContext(opts);
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
    await p.goto('http://localhost:8767/#planning'); await p.waitForSelector('#login input');
    await p.fill('#login input[type=email]', 'fabian@city-drop.com'); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
    await p.waitForTimeout(2000);
    return { p, ctx };
  }
  const phone = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const desk = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 };
  const pre = BEFORE ? 'avant-' : '';
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open({ ...phone, colorScheme: scheme });
    await p.screenshot({ path: `${OUT}/${pre}${scheme}-1-planning.png` });
    await p.screenshot({ path: `${OUT}/${pre}${scheme}-1-planning-long.png`, fullPage: true });
    if (!BEFORE) {
      await p.click('[data-open="p1"]'); await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${scheme}-2-fiche.png` });
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      await p.click('[data-plan-send]'); await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${scheme}-3-liste-du-jour.png` });
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      if (scheme === 'light') {
        await p.click('[data-plan-filter="todo"]'); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/light-4-filtre-a-envoyer.png` });
        await p.click('[data-plan-filter=""]'); await p.waitForTimeout(200);
        await p.click('[data-day]:nth-of-type(7)'); await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/light-5-autre-jour.png` });
      }
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ ...desk });
    await p.screenshot({ path: `${OUT}/${pre}ordi-1-planning.png` });
    await p.screenshot({ path: `${OUT}/${pre}ordi-1-planning-long.png`, fullPage: true });
    if (!BEFORE) {
      await p.click('[data-open="p9"]'); await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/ordi-2-fiche-autre-date.png` });
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      // Parcours réel : changer le statut depuis la fiche, puis passer la liste du jour en « Envoyée ».
      await p.click('[data-open="p2"]'); await p.waitForTimeout(600);
      await p.click('.team-sheet [data-plan-status="realisee"]'); await p.waitForTimeout(1500);
      const d2 = await get('demandes/p2');
      if (d2.fields?.statut?.stringValue !== 'realisee') errors.push('Statut non enregistré depuis la fiche : ' + d2.fields?.statut?.stringValue);
      await p.screenshot({ path: `${OUT}/ordi-3-fiche-statut.png` });
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      await p.click('[data-plan-send]'); await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/ordi-4-liste-du-jour.png` });
      await p.click('.team-sheet [data-plan-mark-sent]'); await p.waitForTimeout(1500);
      const d5 = await get('demandes/p5');
      if (d5.fields?.statut?.stringValue !== 'envoyee') errors.push('« Passer en Envoyée » non enregistré : ' + d5.fields?.statut?.stringValue);
      await p.screenshot({ path: `${OUT}/ordi-5-apres.png` });
      await p.click('[data-open="p3"]'); await p.waitForTimeout(500); await p.click('.team-sheet [data-plan-edit]'); await p.waitForTimeout(500);
      if (!(await p.isVisible('#view-demande'))) errors.push('« Modifier la demande » n\'ouvre pas le formulaire');
      const wide = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      if (!wide) errors.push('la page déborde sur le côté');
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ ...desk, colorScheme: 'dark' });
    await p.screenshot({ path: `${OUT}/${pre}ordi-dark-1-planning.png` });
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
