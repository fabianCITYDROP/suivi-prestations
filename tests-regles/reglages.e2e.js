// Page « Réglages » de l'équipe façon iPhone : captures (téléphone clair / sombre, ordinateur) et vrai parcours
// (interrupteur d'une prestation, tarif ajouté puis retiré + « Annuler », compte ajouté, site ajouté / retiré + « Annuler »,
// « Choisir par défaut »), dans les émulateurs Firebase (aucune donnée réelle).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/reglages.e2e.js <dossier> [avant]"
// (avec ROOT=<autre copie du dépôt> pour photographier l'ancienne page)
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = process.env.ROOT || path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-reglages');
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
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

async function seed() {
  for (const [e, role] of [['fabian@city-drop.com', 'admin'], ['micha@city-drop.com', 'admin'], ['jerome@city-drop.com', 'lecture'], ['robot-mails@citydrop-suivi.app', 'robot']]) await put('comptes/' + e, { role, email: e });
  await put('comptes/allo@exemple.fr', { role: 'prestataire', prestataireId: 'allo-pare-brise', email: 'allo@exemple.fr' });
  await put('comptes/khalid@exemple.fr', { role: 'prestataire', prestataireId: 'khalid', email: 'khalid@exemple.fr' });
  await put('comptes/contact@dusolautoit.fr', { role: 'prestataire', prestataireId: 'du-sol-au-toit', email: 'contact@dusolautoit.fr' });
  await put('config/reglages', { prestataires: ['Allo Pare-Brise', 'Du Sol au Toit', 'Khalid', 'Roig', 'Gaël', 'DHOLLIANDA'],
    sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' }, { nom: 'Gennevilliers', adresse: '12 rue du Port, 92230 Gennevilliers' }, { nom: 'Bordeaux Lac', adresse: '' }, { nom: 'Martigues', adresse: 'Norauto, 13500 Martigues' }],
    flotte: [{ modele: 'Renault Master 2023', cubage: 20 }, { modele: 'Renault Master 2021', cubage: 12 }, { modele: 'Peugeot Expert', cubage: 6 }, { modele: 'Citroën Jumpy', cubage: 3 }] });
  const W = (formule, prixHT) => ({ service: 'lavage', formule, cubageMin: null, cubageMax: null, prixHT });
  await put('prestataires/allo-pare-brise', { nom: 'Allo Pare-Brise', pareBrise: true, interventions: true, lavage: true, tarifs: [{ service: 'pare-brise', cubageMin: null, cubageMax: 11, prixHT: 320 }, { service: 'pare-brise', cubageMin: 12, cubageMax: null, prixHT: 360 }, W('interieur', 25)] });
  await put('prestataires/du-sol-au-toit', { nom: 'Du Sol au Toit', lavage: true, interventions: false, tarifs: [W('complet', 42), W('interieur', 37)] });
  await put('prestataires/khalid', { nom: 'Khalid', lavage: true, interventions: true, tarifs: [W('complet', 42), W('interieur', 37)] });
  await put('prestataires/roig', { nom: 'Roig', lavage: false, interventions: true, tarifs: [] });
  await put('prestataires/gael', { nom: 'Gaël', lavage: true, interventions: true, tarifs: [W('complet', 42)] });
  await put('prestataires/dhollianda', { nom: 'DHOLLIANDA', lavage: false, hayon: true, tarifs: [] });
  const now = new Date().toISOString(); const old = new Date(Date.now() - 90 * 86400000).toISOString();
  const dev = (email, role, extra) => ({ email, role, endpoint: 'https://fcm.googleapis.com/fcm/send/x', jeton: '0123456789abcdef0123456789abcdef', appareil: 'iPhone', createdAt: now, updatedAt: now, ...extra });
  await put('abonnements/f1', dev('fabian@city-drop.com', 'admin'));
  await put('abonnements/a1', dev('allo@exemple.fr', 'prestataire', { prestataireId: 'allo-pare-brise', appareil: 'Android' }));
  await put('abonnements/d1', dev('contact@dusolautoit.fr', 'prestataire', { prestataireId: 'du-sol-au-toit' }));
  await put('abonnements/k1', dev('khalid@exemple.fr', 'prestataire', { prestataireId: 'khalid', updatedAt: old }));
  await put('robot/etat', { passage: ago(12), dernierMail: ago(95), erreur: '' });
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
    await p.evaluate(() => { location.hash = 'reglages'; }); await p.waitForTimeout(900);
    return { p, ctx };
  }
  const row = (p, open) => p.locator(`[data-rg-open="${open}"]`).first();
  const close = async (p) => { await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500); };
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const pre = BEFORE ? 'avant-' : '';
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open({ ...phone, colorScheme: scheme });
    const s = (n, full) => p.screenshot({ path: `${OUT}/${pre}${scheme}-${n}.png`, fullPage: !!full });
    await s('1-reglages'); await s('1-reglages-long', true);
    if (!BEFORE) {
      await row(p, 'prov:Khalid').click(); await p.waitForTimeout(700); await s('2-prestataire');
      await p.locator('.team-sheet .sheet-b').evaluate((el) => (el.scrollTop = 520)); await p.waitForTimeout(200); await s('2b-prestataire-bas');
      await close(p);
      await row(p, 'sites').click(); await p.waitForTimeout(700); await s('3-sites'); await close(p);
      await row(p, 'accounts').click(); await p.waitForTimeout(700); await s('4-acces'); await close(p);
      await row(p, 'robot').click(); await p.waitForTimeout(700); await s('5-robot'); await close(p);
      await row(p, 'alerts').click(); await p.waitForTimeout(700); await s('6-alertes'); await close(p);
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const s = (n, full) => p.screenshot({ path: `${OUT}/${pre}ordi-${n}.png`, fullPage: !!full });
    await s('1-reglages'); await s('1-reglages-long', true);
    if (!BEFORE) {
      await row(p, 'prov:Khalid').click(); await p.waitForTimeout(700); await s('2-prestataire');
      // Interrupteur : Khalid ne fait plus d'interventions
      await p.locator('[data-prov="Khalid"][data-prov-flag="interventions"]').uncheck(); await p.waitForTimeout(900);
      let doc = await get('prestataires/khalid');
      if (doc.fields?.interventions?.booleanValue !== false) errors.push('Interrupteur interventions non enregistré');
      // Tarif ajouté
      await p.selectOption('#t-svc', 'lavage:complet'); await p.fill('#t-min', '12'); await p.fill('#t-prix', '45'); await p.click('#t-add'); await p.waitForTimeout(900);
      doc = await get('prestataires/khalid');
      if (doc.fields?.tarifs?.arrayValue?.values?.length !== 3) errors.push('Tarif non ajouté');
      if (!(await p.textContent('#t-list')).includes('12 m³ et plus')) errors.push('Tarif ajouté non affiché');
      // Tarif retiré puis Annuler
      await p.locator('#t-list [data-rg-act="remove-price"]').last().click(); await p.waitForTimeout(900);
      doc = await get('prestataires/khalid');
      if (doc.fields?.tarifs?.arrayValue?.values?.length !== 2) errors.push('Tarif non retiré');
      await p.click('#toast .toast-action'); await p.waitForTimeout(900);
      doc = await get('prestataires/khalid');
      if (doc.fields?.tarifs?.arrayValue?.values?.length !== 3) errors.push('Annuler (tarif) non enregistré');
      // Compte ajouté depuis sa fiche
      await p.fill('#pa-email', 'Khalid2@Lavage.fr'); await p.click('#pa-add'); await p.waitForTimeout(900);
      doc = await get('comptes/khalid2@lavage.fr');
      if (doc.fields?.role?.stringValue !== 'prestataire' || doc.fields?.prestataireId?.stringValue !== 'khalid') errors.push('Compte prestataire non ajouté');
      await s('3-prestataire-apres');
      // Choisir par défaut
      await p.click('[data-rg-act="make-default"]'); await p.waitForTimeout(900);
      doc = await get('config/reglages');
      if (doc.fields?.prestataires?.arrayValue?.values?.[0]?.stringValue !== 'Khalid') errors.push('Choisir par défaut non enregistré');
      await close(p);
      // Sites : ajout, adresse, retrait + Annuler
      await row(p, 'sites').click(); await p.waitForTimeout(700);
      await p.fill('#s-newsite', 'Lyon Gerland'); await p.fill('#s-newaddr', '5 rue de Gerland, 69007 Lyon'); await p.click('#s-addsite'); await p.waitForTimeout(900);
      doc = await get('config/reglages');
      const sites = () => doc.fields.sites.arrayValue.values.map((v) => v.mapValue.fields.nom.stringValue + '=' + (v.mapValue.fields.adresse?.stringValue || ''));
      if (!sites().includes('Lyon Gerland=5 rue de Gerland, 69007 Lyon')) errors.push('Site ajouté non enregistré ' + sites());
      await s('4-sites');
      await p.click('[data-rg-act="unfold"]'); await p.waitForTimeout(300);
      await p.locator('[data-rg-open="site:Saint-Cloud"]').click(); await p.waitForTimeout(600);
      await p.click('[data-rg-act="remove-site-named"]'); await p.waitForTimeout(900);
      doc = await get('config/reglages');
      if (sites().some((x) => x.startsWith('Saint-Cloud'))) errors.push('Site non retiré');
      await p.click('#toast .toast-action'); await p.waitForTimeout(900);
      doc = await get('config/reglages');
      if (!sites()[0].startsWith('Saint-Cloud')) errors.push('Annuler (site) non enregistré ' + sites());
      await close(p);
      await row(p, 'accounts').click(); await p.waitForTimeout(700); await s('5-acces'); await close(p);
      // Robot arrêté : point rouge + ligne « À regarder »
      await put('robot/etat', { passage: ago(200), dernierMail: ago(300), erreur: '' }); await p.waitForTimeout(1200);
      if (!(await p.isVisible('.rg-todo [data-rg-open="robot"]'))) errors.push('Robot arrêté non signalé en haut');
      await s('6-robot-arrete');
      await row(p, 'robot').click(); await p.waitForTimeout(700); await s('7-robot-feuille'); await close(p);
    }
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
