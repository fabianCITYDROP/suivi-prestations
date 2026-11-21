// Captures du haut des pages prestataire (barre fixe, grand titre, pastille du prestataire) et de « À valider » refait
// (téléphone clair/sombre, page défilée, ordinateur), dans les émulateurs Firebase (aucune donnée réelle).
// Vérifie aussi les écritures (Accepter, Autre date, Pas possible) et que la barre reste en haut en défilant.
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/haut-prestataire.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const D = require('../src/domain.js');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-haut-prestataire');
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
const etat = (doc) => doc.fields?.retour?.mapValue?.fields?.etat?.stringValue;
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then((r) => r.json());
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const sent = { prestataire: 'Khalid', prestataireId: 'khalid', statut: 'envoyee' };
const sc = { site: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' };
const au = { site: 'Aulnay', adresse: '12 rue de la Croix Blanche, 93600 Aulnay-sous-Bois' };
async function seed(thumbs) {
  await put('comptes/khalid@lavage.fr', { role: 'prestataire', prestataireId: 'khalid', email: 'khalid@lavage.fr' });
  await put('comptes/vide@lavage.fr', { role: 'prestataire', prestataireId: 'vide', email: 'vide@lavage.fr' });
  await put('config/reglages', { prestataires: ['Khalid', 'Vide'], sites: [{ nom: 'Saint-Cloud', adresse: sc.adresse }, { nom: 'Aulnay', adresse: au.adresse }], flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  await put('prestataires/khalid', { nom: 'Allo Pare-Brise', interventions: true, lavage: true, pareBrise: true });
  await put('prestataires/vide', { nom: 'Lavage Express', interventions: true, lavage: true });
  const mk = D.modelKey({ modele: 'Peugeot Boxer', cubage: 12 });
  await put('modeles/' + mk, { modele: 'Peugeot Boxer', cubage: 12, photos: thumbs.map((t, i) => ({ key: 'm' + i, thumb: t })) });
  await put('demandes/v1', { ...sent, ...sc, service: 'lavage', plaque: 'GT-910-AB', modele: 'Renault Master 2023', cubage: 20, date: day(1), debut: '09:00', fin: '12:00' });
  await put('demandes/v2', { ...sent, ...au, service: 'pare-brise', plaque: 'FK-402-ZD', modele: 'Peugeot Boxer', cubage: 12, date: day(2), debut: '08:30', fin: '19:30', notes: 'Impact côté conducteur, clés à l\'accueil' });
  await put('demandes/v3', { ...sent, ...au, service: 'intervention', plaque: 'HD-118-QS', modele: 'Renault Trafic', cubage: 6, date: day(3), dateFin: day(5), debut: '08:00', fin: '18:00', tache: 'Changer l\'ampoule du feu arrière gauche' });
  await put('demandes/v4', { ...sent, ...sc, service: 'lavage', plaque: 'EZ-655-LM', modele: 'Citroën Jumper', cubage: 17, date: day(4), debut: '14:00', fin: '17:00',
    retour: { etat: 'autre-date', date: day(5), debut: '10:00', par: 'khalid@lavage.fr', at: new Date().toISOString(), vu: false } });
  await put('demandes/t1', { ...sent, statut: 'confirmee', ...sc, service: 'lavage', plaque: 'GA-731-PM', modele: 'Renault Master 2023', cubage: 20, date: day(0), debut: '09:00', fin: '12:00' });
  await put('comptes/equipe@city-drop.com', { role: 'admin', email: 'equipe@city-drop.com' }); await signUp('equipe@city-drop.com');
  await signUp('khalid@lavage.fr'); await signUp('vide@lavage.fr');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  // Deux fausses photos du pare-brise (dégradés), en vrai JPEG.
  const tp = await b.newPage({ viewport: { width: 120, height: 120 } });
  const thumbs = [];
  for (const bg of ['linear-gradient(160deg,#9fb7c8,#3d5668)', 'linear-gradient(200deg,#c9d3da,#55687a)']) {
    await tp.setContent(`<body style="margin:0;width:120px;height:120px;background:${bg}"></body>`);
    thumbs.push('data:image/jpeg;base64,' + (await tp.screenshot({ type: 'jpeg', quality: 70 })).toString('base64'));
  }
  await tp.close();
  await seed(thumbs);
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8765);
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
    if (!email.startsWith('equipe')) { await p.click('[data-tab="validate"]'); await p.waitForTimeout(400); }
    return { p, ctx };
  }
  const phone = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const desk = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 };
  const pre = BEFORE ? 'avant-' : '';
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open('khalid@lavage.fr', { ...phone, colorScheme: scheme });
    await p.screenshot({ path: `${OUT}/${pre}${scheme}-1-a-valider.png` });
    await p.screenshot({ path: `${OUT}/${pre}${scheme}-1-a-valider-long.png`, fullPage: true });
    await p.evaluate(() => scrollTo(0, 520)); await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/${pre}${scheme}-1b-defile.png` });
    if (!BEFORE && await p.evaluate(() => document.querySelector('header.top').getBoundingClientRect().top) > 1) errors.push('barre du haut pas fixe');
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300);
    await p.click('[data-tab="today"]'); await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/${pre}${scheme}-7-aujourdhui.png` });
    await p.click('[data-tab="validate"]'); await p.waitForTimeout(400);
    if (!BEFORE) {
      await p.click('[data-act="date"][data-id="v4"]'); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/${scheme}-2-feuille-autre-date.png` });
      await p.click('.sheet-x'); await p.waitForTimeout(500);
      await p.click('[data-act="refuse"][data-id="v3"]'); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/${scheme}-3-feuille-pas-possible.png` });
      await p.click('.sheet-x'); await p.waitForTimeout(500);
    }
    const e = await open('vide@lavage.fr', { ...phone, colorScheme: scheme });
    await e.p.screenshot({ path: `${OUT}/${pre}${scheme}-6-vide.png` }); await e.ctx.close();
    if (!BEFORE && scheme === 'light') { // Accepter : la carte part vers « À venir », le compteur de l'onglet rebondit
      await p.click('[data-take="v1"]');
      await p.waitForTimeout(260); await p.screenshot({ path: `${OUT}/light-4-accepter-coche.png` });
      await p.waitForTimeout(420); await p.screenshot({ path: `${OUT}/light-4-accepter-envol.png` });
      await p.waitForTimeout(1100); await p.screenshot({ path: `${OUT}/light-5-apres-accepter.png` });
      if (etat(await get('demandes/v1')) !== 'confirme') errors.push('Accepter non enregistré');
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open('khalid@lavage.fr', desk);
    await p.screenshot({ path: `${OUT}/${pre}ordi-1-a-valider.png` });
    await p.evaluate(() => scrollTo(0, 460)); await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${pre}ordi-1b-defile.png` });
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300);
    if (!BEFORE) {
      await p.click('[data-act="date"][data-id="v2"]'); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/ordi-2-feuille-autre-date.png` });
      await p.click('[data-asheet] [data-day]'); await p.click('[data-asend]'); await p.waitForTimeout(1500);
      if (etat(await get('demandes/v2')) !== 'autre-date') errors.push('Autre date non enregistrée');
      await p.click('[data-act="refuse"][data-id="v3"]'); await p.waitForTimeout(500);
      await p.fill('[data-asheet] [data-note]', 'Pièce indisponible'); await p.click('[data-asend]'); await p.waitForTimeout(1500);
      if (etat(await get('demandes/v3')) !== 'refuse') errors.push('Pas possible non enregistré');
      await p.screenshot({ path: `${OUT}/ordi-3-apres-reponses.png` });
    }
    await ctx.close();
  }
  // Côté équipe : la barre reste en haut en défilant, la barre d'onglets du bas reste en bas (téléphone).
  for (const [name, opts] of [['equipe-tel', { ...phone, colorScheme: 'light' }], ['equipe-tel-sombre', { ...phone, colorScheme: 'dark' }], ['equipe-ordi', desk]]) {
    const { p, ctx } = await open('equipe@city-drop.com', opts);
    await p.screenshot({ path: `${OUT}/${name}-1.png` });
    await p.evaluate(() => scrollTo(0, 400)); await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/${name}-2-defile.png` });
    if (!BEFORE) {
      const top = await p.evaluate(() => document.querySelector('header.top').getBoundingClientRect().top);
      if (top > 1) errors.push(name + ' : barre du haut pas fixe');
      if (name.includes('tel')) { const nb = await p.evaluate(() => innerHeight - document.querySelector('nav.tabs').getBoundingClientRect().bottom); if (Math.abs(nb) > 1) errors.push(name + ' : barre du bas décrochée ' + nb); }
    }
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
