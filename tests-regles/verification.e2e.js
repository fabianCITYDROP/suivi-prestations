// Captures de la page Vérification de l'équipe (téléphone clair/sombre + ordinateur) et parcours relance → réponse collée → mise à jour,
// dans les émulateurs Firebase (aucune donnée réelle).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/verification.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = process.env.SITE_DIR || path.join(__dirname, '..'); // SITE_DIR : un autre index.html (captures « avant »)
const OUT = process.argv[2] || path.join(__dirname, 'captures-verification');
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
  const pb = (id, plaque, d, site, statut, extra = {}) => put('demandes/' + id, { ...u, ...allo, ...site, service: 'pare-brise', plaque, modele: 'Renault Master 2023', cubage: 20, date: day(d), debut: '09:00', fin: '12:00', statut, prixHT: 360, ...extra });
  await pb('v1', 'GA-731-PM', -6, sc, 'envoyee');
  await pb('v2', 'FK-402-ZD', -6, au, 'confirmee', { modele: 'Opel Movano 2024', cubage: 12, prixHT: 320, debut: '13:00', fin: '17:00' });
  await pb('v3', 'HB-220-KL', -3, sc, 'envoyee');
  await pb('v4', 'GT-910-AB', -3, ld, 'confirmee');
  await pb('v5', 'EZ-655-LM', -1, au, 'envoyee', { debut: '14:00', fin: '17:00' });
  await pb('v6', 'GL-554-XC', 2, sc, 'confirmee');
  await pb('v7', 'FR-377-TT', -2, ld, 'realisee');
  await put('demandes/v8', { ...u, ...dsat, ...sc, service: 'lavage', lavage: 'complet', plaque: 'GV-118-RB', modele: 'Renault Master 2023', cubage: 20, date: day(-2), debut: '09:00', fin: '12:00', statut: 'envoyee', prixHT: 42 });
  await put('demandes/v9', { ...u, ...kh, ...au, service: 'intervention', plaque: 'HD-118-QS', modele: 'Renault Trafic', cubage: 6, date: day(-4), debut: '08:00', fin: '18:00', statut: 'confirmee', tache: "Changer l'ampoule du feu arrière gauche" });
  await signUp('fabian@city-drop.com');
}
const REPLY = "Bonjour, GA-731-PM ok, HB220KL fait, GT-910-AB fait aussi. EZ-655-LM pas encore. Et AA-999-ZZ fait hier.";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await seed();
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8768);
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
    await p.goto('http://localhost:8768/#verif'); await p.waitForSelector('#login input');
    await p.fill('#login input[type=email]', 'fabian@city-drop.com'); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
    await p.waitForTimeout(2000);
    return { p, ctx };
  }
  const phone = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const desk = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 };
  const pre = BEFORE ? 'avant-' : '';
  const ALLO = '[data-vf-prov="ALLO pare-brise 78"]';
  const paste = async (p) => { await p.fill('#v-paste', REPLY); await p.waitForTimeout(400); };
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open({ ...phone, colorScheme: scheme });
    if (BEFORE) {
      await p.selectOption('#v-prest', 'ALLO pare-brise 78'); await p.waitForTimeout(300);
      await p.screenshot({ path: `${OUT}/avant-${scheme}-1-verification.png` });
      await p.screenshot({ path: `${OUT}/avant-${scheme}-1-verification-long.png`, fullPage: true });
    } else {
      await p.screenshot({ path: `${OUT}/${scheme}-1-tous.png` });
      await p.click(ALLO); await p.waitForTimeout(300);
      await p.screenshot({ path: `${OUT}/${scheme}-2-allo.png` });
      await paste(p);
      await p.screenshot({ path: `${OUT}/${scheme}-3-reponse-collee.png` });
      await p.evaluate(() => document.querySelector('#vfListTitle').scrollIntoView({ block: 'start' })); await p.waitForTimeout(300);
      await p.screenshot({ path: `${OUT}/${scheme}-4-coches-barre.png` });
      await p.screenshot({ path: `${OUT}/${scheme}-0-page-long.png`, fullPage: true });
      const n = await p.textContent('#vfBarN');
      if (n !== '3') errors.push(`${scheme} : 3 plaques cochées attendues, ${n}`);
      if (!(await p.textContent('#vfMatch')).includes('AA-999-ZZ')) errors.push('la plaque hors liste n\'est pas signalée');
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ ...desk });
    if (BEFORE) {
      await p.selectOption('#v-prest', 'ALLO pare-brise 78'); await p.waitForTimeout(300);
      await p.screenshot({ path: `${OUT}/avant-ordi-1-verification.png` });
    } else {
      await p.click(ALLO); await p.waitForTimeout(300);
      await p.screenshot({ path: `${OUT}/ordi-1-allo.png` });
      await paste(p);
      await p.screenshot({ path: `${OUT}/ordi-2-reponse-collee.png` });
      // Parcours réel : « Réalisée » sur les 3 cochés, puis « Annuler » dans la bulle.
      await p.click('#vfBar [data-bulk="realisee"]'); await p.waitForTimeout(1800);
      for (const id of ['v1', 'v3', 'v4']) {
        const d = await get('demandes/' + id);
        if (d.fields?.statut?.stringValue !== 'realisee') errors.push(`${id} non passé en Réalisée : ${d.fields?.statut?.stringValue}`);
      }
      const v5 = await get('demandes/v5');
      if (v5.fields?.statut?.stringValue !== 'envoyee') errors.push('v5 (non cité) a changé : ' + v5.fields?.statut?.stringValue);
      await p.screenshot({ path: `${OUT}/ordi-3-apres-bulle-annuler.png` });
      await p.click('#toast .toast-action'); await p.waitForTimeout(1800);
      const back = { v1: 'envoyee', v3: 'envoyee', v4: 'confirmee' };
      for (const [id, st] of Object.entries(back)) {
        const d = await get('demandes/' + id);
        if (d.fields?.statut?.stringValue !== st) errors.push(`« Annuler » n'a pas remis ${id} en ${st} : ${d.fields?.statut?.stringValue}`);
      }
      // Cocher à la main, « Confirmée », et la fiche depuis la flèche.
      await p.click('[data-check="v5"]'); await p.waitForTimeout(200);
      await p.click('#vfBar [data-bulk="confirmee"]'); await p.waitForTimeout(1500);
      const v5b = await get('demandes/v5');
      if (v5b.fields?.statut?.stringValue !== 'confirmee') errors.push('v5 non passé en Confirmée : ' + v5b.fields?.statut?.stringValue);
      await p.click('[data-vf-open="v2"]'); await p.waitForTimeout(700);
      if (!(await p.isVisible('.team-sheet.on'))) errors.push('la flèche n\'ouvre pas la fiche');
      await p.screenshot({ path: `${OUT}/ordi-4-fiche.png` });
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(400);
      await p.click('[data-range="30"]'); await p.click('[data-st="all"]'); await p.waitForTimeout(300);
      if (!(await p.isVisible('[data-check="v7"]'))) errors.push('« Toutes » ne montre pas la demande réalisée');
      const wide = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      if (!wide) errors.push('la page déborde sur le côté');
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ ...desk, colorScheme: 'dark' });
    if (BEFORE) await p.selectOption('#v-prest', 'ALLO pare-brise 78'); else { await p.click(ALLO); await paste(p); }
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/${pre}ordi-dark-1-verification.png` });
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ ...phone, colorScheme: 'light' });
    if (!BEFORE) { const w = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth); if (!w) errors.push('téléphone : la page déborde sur le côté'); }
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
