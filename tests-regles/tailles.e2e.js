// Captures « tailles » (21/11/2026) : connexion, écrans prestataire, Signaler, visionneuse photo et Planning équipe,
// pour comparer avant / après la réduction des tailles. Vérifie aussi le zoom à deux doigts de la visionneuse.
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/tailles.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const D = require('../src/domain.js');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-tailles');
const BEFORE = process.argv[3] === 'avant';
const pre = BEFORE ? 'avant-' : '';
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
const now = (hm) => `${day(0)}T${hm}:00.000Z`;

async function drawPhotos(b) {
  const p = await b.newPage({ viewport: { width: 640, height: 480 } });
  const out = [];
  for (const [sky, glass, ix, iy] of [['#9fc3dc', '#2b3b47', 38, 52], ['#c7d6df', '#33444f', 62, 40]]) {
    await p.setContent(`<body style="margin:0;width:640px;height:480px;background:${sky};position:relative;overflow:hidden">
      <div style="position:absolute;left:40px;right:40px;top:90px;height:300px;background:#e9eef1;border-radius:40px 40px 20px 20px"></div>
      <div style="position:absolute;left:80px;right:80px;top:120px;height:200px;background:${glass};clip-path:polygon(6% 0,94% 0,100% 100%,0 100%)"></div>
      <div style="position:absolute;left:${ix}%;top:${iy}%;width:26px;height:26px;border-radius:50%;border:3px solid #dfe8ee"></div></body>`);
    out.push('data:image/jpeg;base64,' + (await p.screenshot({ type: 'jpeg', quality: 80 })).toString('base64'));
  }
  await p.close();
  return out;
}

const SC = { site: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' };
const AU = { site: 'Aulnay', adresse: '12 rue de la Croix Blanche, 93600 Aulnay-sous-Bois' };
const MASTER = { modele: 'Renault Master 2023', cubage: 20 };
async function seed(photos) {
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('comptes/allo@test.fr', { role: 'prestataire', prestataireId: 'allo', email: 'allo@test.fr' });
  await put('config/reglages', { prestataires: ['ALLO pare-brise 78', 'Khalid'], sites: [{ nom: 'Saint-Cloud', adresse: SC.adresse }, { nom: 'Aulnay', adresse: AU.adresse }], flotte: [MASTER, { modele: 'Peugeot Boxer', cubage: 12 }] });
  await put('prestataires/allo', { nom: 'ALLO pare-brise 78', interventions: true, lavage: true, pareBrise: true, tarifs: [] });
  await put('prestataires/khalid', { nom: 'Khalid', interventions: true, lavage: true, tarifs: [] });
  const mk = D.modelKey(MASTER); const list = [];
  for (const [i, data] of photos.entries()) { const key = `${mk}_ex${i}`; await put('photos/' + key, { ...MASTER, data }); list.push({ key, thumb: data, addedAt: new Date().toISOString() }); }
  await put('modeles/' + mk, { ...MASTER, photos: list });
  const a = { prestataire: 'ALLO pare-brise 78', prestataireId: 'allo', statut: 'confirmee' };
  await put('demandes/t1', { ...a, ...SC, service: 'pare-brise', plaque: 'GA-731-PM', ...MASTER, date: day(0), debut: '09:00', fin: '12:00', prixHT: 360 });
  await put('demandes/t2', { ...a, ...SC, service: 'lavage', plaque: 'FK-402-ZD', modele: 'Peugeot Boxer', cubage: 12, date: day(0), debut: '09:00', fin: '12:00', prixHT: 37, notes: "Clés à l'accueil, demander Karim" });
  await put('demandes/t3', { ...a, ...AU, service: 'intervention', plaque: 'HD-118-QS', modele: 'Renault Trafic', cubage: 6, date: day(-2), dateFin: day(1), debut: '08:00', fin: '18:00', tache: "Changer l'ampoule du feu arrière gauche" });
  await put('demandes/t4', { ...a, ...AU, service: 'lavage', plaque: 'EZ-655-LM', modele: 'Citroën Jumper', cubage: 17, date: day(0), debut: '14:00', fin: '17:00', prixHT: 42 });
  await put('demandes/v1', { ...a, statut: 'envoyee', ...SC, service: 'lavage', plaque: 'GT-910-AB', ...MASTER, date: day(2), debut: '09:00', fin: '12:00' });
  await put('demandes/v2', { ...a, statut: 'envoyee', ...AU, service: 'pare-brise', plaque: 'GL-554-XC', ...MASTER, date: day(3), debut: '13:00', fin: '17:00' });
  await put('demandes/u1', { ...a, ...SC, service: 'lavage', plaque: 'GV-118-RB', ...MASTER, date: day(4), debut: '09:00', fin: '12:00' });
  await put('demandes/f1', { ...a, ...SC, service: 'lavage', plaque: 'FR-377-TT', ...MASTER, date: day(0), debut: '08:00', fin: '09:00', statut: 'realisee', prixHT: 37, retour: { etat: 'fait', at: now('08:42'), vu: false } });
  await put('demandes/p1', { ...a, ...SC, prestataire: 'Khalid', prestataireId: 'khalid', service: 'lavage', plaque: 'HB-220-KL', ...MASTER, date: day(0), debut: '13:00', fin: '17:00', statut: 'a_envoyer', prixHT: 37 });
  await signUp('fabian@city-drop.com'); await signUp('allo@test.fr');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  await seed(await drawPhotos(b));
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8765);
  const errors = [];
  async function page(opts) {
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
    await p.goto('http://localhost:8765/'); await p.waitForSelector('#login input');
    return { p, ctx };
  }
  async function login(p, email) {
    await p.fill('#login input[type=email]', email); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button[type=submit]');
    await p.waitForTimeout(1800);
  }
  const phone = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const shot = (p, name, full) => p.screenshot({ path: `${OUT}/${pre}${name}.png`, fullPage: !!full });
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await page({ ...phone, colorScheme: scheme });
    await shot(p, `${scheme}-0-connexion`);
    await login(p, 'allo@test.fr');
    for (const [tab, n] of [['today', 1], ['validate', 2], ['upcoming', 3], ['done', 4]]) {
      const t = await p.$(`[data-tab="${tab}"]`); if (!t) { errors.push('onglet ' + tab + ' absent'); continue; }
      await t.click(); await p.waitForTimeout(500); await shot(p, `${scheme}-${n}-${tab}`);
    }
    if (scheme === 'light') {
      await p.click('[data-tab="today"]'); await p.waitForTimeout(400);
      await shot(p, 'light-1-today-long', true);
      const sig = await p.$('[data-sheet-open]');
      if (sig) { await sig.click(); await p.waitForTimeout(700); await shot(p, 'light-5-signaler'); await p.keyboard.press('Escape'); await p.waitForTimeout(400); }
      else errors.push('bouton Signaler introuvable');
      await p.click('[data-tab="today"]'); await p.waitForTimeout(300);
      const ph = await p.$('.job-photos [data-zoom]');
      if (!ph) errors.push('pas de photo sur la carte pare-brise');
      else {
        await ph.click(); await p.waitForTimeout(900); await shot(p, 'light-6-photo');
        if (!BEFORE) {
          // Pincer à deux doigts (événements tactiles via CDP), puis déplacer d'un doigt.
          const cdp = await ctx.newCDPSession(p);
          const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
          await touch('touchStart', [[170, 420], [220, 420]]);
          for (let i = 1; i <= 10; i++) { await touch('touchMove', [[170 - i * 10, 420], [220 + i * 10, 420]]); await p.waitForTimeout(16); }
          await touch('touchEnd', []); await p.waitForTimeout(400);
          const sc = await p.$eval('.pho-v-stage img', (i) => new DOMMatrix(getComputedStyle(i).transform).a);
          if (!(sc > 2)) errors.push('le pincement ne zoome pas (échelle ' + sc + ')');
          await shot(p, 'light-7-photo-zoom');
          await touch('touchStart', [[200, 420]]);
          for (let i = 1; i <= 8; i++) { await touch('touchMove', [[200 + i * 10, 420 + i * 6]]); await p.waitForTimeout(16); }
          await touch('touchEnd', []); await p.waitForTimeout(400);
          const m = await p.$eval('.pho-v-stage img', (i) => new DOMMatrix(getComputedStyle(i).transform));
          if (!(m.e > 30)) errors.push('la photo zoomée ne se déplace pas (x ' + m.e + ')');
          if (await p.$eval('.pho-viewer', (v) => v.hidden)) errors.push('la visionneuse s\'est fermée pendant le déplacement');
          await shot(p, 'light-8-photo-deplacee');
          // Double appui du doigt : retour à la taille normale.
          for (let k = 0; k < 2; k++) { await touch('touchStart', [[200, 420]]); await touch('touchEnd', []); await p.waitForTimeout(90); }
          await p.waitForTimeout(500);
          const back = await p.$eval('.pho-v-stage img', (i) => new DOMMatrix(getComputedStyle(i).transform).a);
          if (Math.abs(back - 1) > 0.01) errors.push('le double appui ne revient pas à 1 (' + back + ')');
        }
        await p.keyboard.press('Escape'); await p.waitForTimeout(400);
      }
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await page({ ...phone, colorScheme: 'light' });
    await login(p, 'fabian@city-drop.com');
    await shot(p, 'light-9-equipe-planning');
    await ctx.close();
  }
  {
    const { p, ctx } = await page({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
    await shot(p, 'ordi-0-connexion');
    await login(p, 'allo@test.fr');
    await shot(p, 'ordi-1-today');
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
