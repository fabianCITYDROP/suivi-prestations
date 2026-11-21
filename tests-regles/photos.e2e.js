// Page « Photos » de l'équipe façon app Photos : captures (téléphone clair / sombre, ordinateur) et vrai parcours
// (feuille d'un album, ajout d'une photo, plein écran, glisser vers la suivante, Supprimer puis Annuler, filtre « Sans photo »),
// dans les émulateurs Firebase (aucune donnée réelle). Les « photos » sont des dessins d'exemple.
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/photos.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const D = require('../src/domain.js');
const ROOT = process.env.ROOT_DIR || path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-photos');
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

const FLEET = [
  { modele: 'Renault Master 2023', cubage: 20 }, { modele: 'Opel Movano 2023', cubage: 17 }, { modele: 'Opel Movano 2023', cubage: 12 },
  { modele: 'Fiat Ducato 2024', cubage: 14 }, { modele: 'Opel Vivaro 2023', cubage: 5 }, { modele: 'Peugeot Expert', cubage: 6 },
];
// Dessins d'exemple : un pare-brise vu de face (ciel, vitre, impact), chaque fois un peu différent.
async function drawPhotos(b) {
  const p = await b.newPage({ viewport: { width: 640, height: 480 } });
  const out = [];
  const looks = [['#9fc3dc', '#2b3b47', 38, 52], ['#c7d6df', '#33444f', 62, 40], ['#b9cfe0', '#26333c', 30, 30], ['#d6dde2', '#3a4851', 55, 58], ['#a8bccb', '#2f3e48', 45, 35]];
  for (const [sky, glass, ix, iy] of looks) {
    await p.setContent(`<body style="margin:0;width:640px;height:480px;background:${sky};position:relative;overflow:hidden;font-family:sans-serif">
      <div style="position:absolute;left:40px;right:40px;top:90px;height:300px;background:#e9eef1;border-radius:40px 40px 20px 20px"></div>
      <div style="position:absolute;left:80px;right:80px;top:120px;height:200px;background:${glass};clip-path:polygon(6% 0,94% 0,100% 100%,0 100%);border-radius:12px"></div>
      <div style="position:absolute;left:${ix}%;top:${iy}%;width:26px;height:26px;border-radius:50%;border:3px solid #dfe8ee;box-shadow:0 0 0 6px rgba(223,232,238,.35)"></div>
      <div style="position:absolute;left:70px;top:340px;width:90px;height:34px;background:#f2f4f5;border-radius:8px"></div>
      <div style="position:absolute;right:70px;top:340px;width:90px;height:34px;background:#f2f4f5;border-radius:8px"></div></body>`);
    const full = (await p.screenshot({ type: 'jpeg', quality: 80 })).toString('base64');
    await p.setViewportSize({ width: 640, height: 480 });
    out.push('data:image/jpeg;base64,' + full);
  }
  await p.close();
  return out;
}

async function seed(photos) {
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('config/reglages', { prestataires: ['ALLO pare-brise 78', 'Khalid'], sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot' }, { nom: 'Gennevilliers', adresse: '12 rue du Port' }], flotte: FLEET });
  await put('prestataires/allo-pare-brise-78', { nom: 'ALLO pare-brise 78', tarifs: [] });
  await put('prestataires/khalid', { nom: 'Khalid', interventions: true, tarifs: [] });
  // Albums : Master 2 photos, Movano 17 3 photos, Ducato 1 photo ; Movano 12, Vivaro et Expert sans photo.
  const albums = [[FLEET[0], [0, 1]], [FLEET[1], [2, 3, 4]], [FLEET[3], [3]]];
  for (const [m, idx] of albums) {
    const mk = D.modelKey(m);
    const list = [];
    for (const [n, i] of idx.entries()) {
      const key = `${mk}_ex${n}`;
      await put('photos/' + key, { modele: m.modele, cubage: m.cubage, data: photos[i] });
      list.push({ key, thumb: photos[i], addedAt: new Date().toISOString() });
    }
    await put('modeles/' + mk, { modele: m.modele, cubage: m.cubage, photos: list });
  }
  const base = { prestataire: 'ALLO pare-brise 78', prestataireId: 'allo-pare-brise-78', service: 'pare-brise', site: 'Saint-Cloud', adresse: 'Quai Carnot', debut: '08:30', fin: '19:30', statut: 'envoyee', prixHT: 360 };
  await put('demandes/w1', { ...base, plaque: 'GH-482-KL', ...FLEET[0], date: day(1) });
  await put('demandes/w2', { ...base, plaque: 'FT-219-ZB', ...FLEET[1], date: day(0), statut: 'confirmee' });
  await put('demandes/w3', { ...base, plaque: 'GC-618-VA', ...FLEET[2], site: 'Gennevilliers', adresse: '12 rue du Port', date: day(2), statut: 'a_envoyer', prixHT: 360 });
  await put('demandes/w4', { ...base, plaque: 'GA-731-PM', ...FLEET[0], date: day(3) });
  await put('demandes/l1', { ...base, service: 'lavage', prestataire: 'Khalid', prestataireId: 'khalid', plaque: 'HB-550-TR', ...FLEET[4], date: day(1), prixHT: 37 });
  await signUp('fabian@city-drop.com');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const photos = await drawPhotos(b);
  await seed(photos);
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8765);
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
    await p.evaluate(() => { location.hash = 'photos'; }); await p.waitForTimeout(900);
    return { p, ctx };
  }
  const mk0 = D.modelKey(FLEET[0]);
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const pre = BEFORE ? 'avant-' : '';
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open({ ...phone, colorScheme: scheme });
    const s = (n, full) => p.screenshot({ path: `${OUT}/${pre}${scheme}-${n}.png`, fullPage: !!full });
    await s('1-photos'); await s('1-photos-long', true);
    if (BEFORE) { await p.click(`.veh-card[data-model="${mk0}"]`); await p.waitForTimeout(600); await s('2-modele'); }
    else {
      await p.click(`.pho-album[data-model="${mk0}"]`); await p.waitForTimeout(700); await s('2-album');
      await p.click('.pho-ph >> nth=0'); await p.waitForTimeout(900); await s('3-plein-ecran');
      await p.click('[data-v-close]'); await p.waitForTimeout(400);
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      await p.click('[data-pho-filter="missing"]'); await p.waitForTimeout(400); await s('4-sans-photo');
      await p.click(`.pho-album[data-model="${D.modelKey(FLEET[2])}"]`); await p.waitForTimeout(700); await s('5-album-vide');
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const s = (n, full) => p.screenshot({ path: `${OUT}/${pre}ordi-${n}.png`, fullPage: !!full });
    await s('1-photos');
    if (BEFORE) { await p.click(`.veh-card[data-model="${mk0}"]`); await p.waitForTimeout(600); await s('2-modele'); }
    else {
      await p.click(`.pho-album[data-model="${mk0}"]`); await p.waitForTimeout(700); await s('2-album');
      // Ajout d'une photo par le bouton « Ajouter »
      const file = path.join(OUT, 'ajout.jpg'); fs.writeFileSync(file, Buffer.from(photos[4].split(',')[1], 'base64'));
      const chooser = p.waitForEvent('filechooser'); await p.click('[data-pho-add]'); await (await chooser).setFiles(file);
      await p.waitForTimeout(2500);
      let doc = await get('modeles/' + mk0);
      const n = () => (doc.fields?.photos?.arrayValue?.values || []).length;
      if (n() !== 3) errors.push('Ajout : ' + n() + ' photos au lieu de 3');
      if ((await p.locator('.pho-sheet .pho-ph').count()) !== 3) errors.push('La feuille ne montre pas la photo ajoutée');
      await s('3-apres-ajout');
      // Plein écran, photo suivante au clavier
      await p.click('.pho-ph >> nth=0'); await p.waitForTimeout(900); await s('4-plein-ecran');
      await p.keyboard.press('ArrowRight'); await p.waitForTimeout(600);
      if (!(await p.textContent('.pho-v-title span')).startsWith('2 sur 3')) errors.push('Flèche droite : pas la photo 2');
      // Supprimer puis Annuler
      await p.click('[data-v-remove]'); await p.waitForTimeout(1200); await s('5-supprimee-annuler');
      doc = await get('modeles/' + mk0);
      if (n() !== 2) errors.push('Supprimer : ' + n() + ' photos au lieu de 2');
      await p.click('#toast .toast-action'); await p.waitForTimeout(1800);
      doc = await get('modeles/' + mk0);
      if (n() !== 3) errors.push('Annuler la suppression : ' + n() + ' photos au lieu de 3');
      await p.keyboard.press('Escape'); await p.waitForTimeout(400);
      if (!(await p.isVisible('.team-sheet.on'))) errors.push('Échap dans le plein écran a fermé la feuille');
      await p.keyboard.press('Escape'); await p.waitForTimeout(500);
      // Encadré « à compléter » → ouvre le Movano 12 sans photo
      await p.click('.pho-alert'); await p.waitForTimeout(700); await s('6-album-vide');
      if (!(await p.textContent('#teamSheetTitle')).includes('Movano')) errors.push('L\'encadré n\'ouvre pas le bon modèle');
      await p.keyboard.press('Escape'); await p.waitForTimeout(400);
      // Recherche
      await p.fill('#p-q', 'ducato'); await p.waitForTimeout(300);
      if ((await p.locator('.pho-album').count()) !== 1) errors.push('Recherche « ducato » : pas un seul modèle');
      await p.fill('#p-q', ''); await p.waitForTimeout(300);
      // Photo en grand depuis le Planning (data-zoom) : même plein écran, sans barre d'actions
      await p.evaluate(() => { location.hash = 'planning'; }); await p.waitForTimeout(700);
    }
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
