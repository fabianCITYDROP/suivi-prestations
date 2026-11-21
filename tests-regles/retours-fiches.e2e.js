// Retours : fiches véhicule courtes, 3 par ligne, logo du type de prestation (21/11/2026). Captures seulement.
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/retours-fiches.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-retours');
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
  const P = { khalid: 'Khalid', allo: 'Allo Pare-Brise', gael: 'Gaël', roig: 'Roig', dsat: 'Du Sol au Toit' };
  await put('config/reglages', { prestataires: Object.values(P), sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' }, { nom: 'Gennevilliers', adresse: '12 rue du Port' }, { nom: 'Bordeaux Lac', adresse: 'Av. des 40 Journaux' }], flotte: [{ modele: 'Renault Master 2023', cubage: 20 }, { modele: 'Peugeot Expert', cubage: 6 }] });
  for (const [id, nom] of Object.entries(P)) await put('prestataires/' + id, { nom, interventions: true, tarifs: [] });
  const base = { modele: 'Renault Master 2023', cubage: 20, site: 'Saint-Cloud', adresse: 'Quai Carnot', debut: '09:00', fin: '12:00', prixHT: 37 };
  const dem = (id, o) => put('demandes/' + id, { ...base, ...o, prestataireId: Object.keys(P).find((k) => P[k] === o.prestataire) });
  await dem('a1', { prestataire: 'Gaël', service: 'lavage', plaque: 'GA-731-PM', site: 'Bordeaux Lac', date: day(0), statut: 'envoyee', retour: { etat: 'autre-date', at: at(0, '08:05'), par: 'gael@x.fr', date: day(2), debut: '10:00', note: 'Portail fermé le matin' } });
  await dem('a2', { prestataire: 'Roig', service: 'intervention', tache: 'Changer le rétroviseur', plaque: 'FT-219-ZB', site: 'Gennevilliers', date: day(0), statut: 'confirmee', retour: { etat: 'absent', at: at(0, '09:40'), par: 'roig@x.fr', note: 'Pas sur le parking à 9 h 30' } });
  await dem('a3', { prestataire: 'Du Sol au Toit', service: 'lavage', plaque: 'HB-550-TR', modele: 'Peugeot Expert', cubage: 6, date: day(1), statut: 'envoyee', retour: { etat: 'refuse', at: at(0, '07:52'), par: 'dsat@x.fr', note: 'Pas de point d\'eau ce jour-là' } });
  await dem('a4', { prestataire: 'Khalid', service: 'lavage', plaque: 'GD-108-QA', date: day(0), statut: 'confirmee', retour: { etat: 'erreur', at: at(0, '10:21'), par: 'khalid@x.fr', note: 'Je me suis trompé de camion' } });
  await dem('a5', { prestataire: 'Khalid', service: 'lavage', plaque: 'GE-402-LM', date: day(0), statut: 'confirmee', retour: { etat: 'fait', at: at(0, '10:12'), par: 'khalid@x.fr' } });
  await dem('a6', { prestataire: 'Khalid', service: 'lavage', plaque: 'GF-913-RS', date: day(0), statut: 'confirmee', retour: { etat: 'fait', at: at(0, '09:47'), par: 'khalid@x.fr', note: 'Intérieur très sale' } });
  await dem('a7', { prestataire: 'Allo Pare-Brise', service: 'pare-brise', plaque: 'GH-482-KL', date: day(1), statut: 'envoyee', retour: { etat: 'confirme', at: at(0, '08:30'), par: 'allo@x.fr' } });
  await dem('a8', { prestataire: 'Du Sol au Toit', service: 'lavage', plaque: 'GK-777-AB', date: day(0), statut: 'confirmee', retour: { etat: 'fait', at: at(0, '08:58'), par: 'dsat@x.fr' } });
  await dem('a9', { prestataire: 'Khalid', service: 'lavage', plaque: 'GL-310-CD', date: day(-1), statut: 'realisee', retour: { etat: 'fait', at: at(-1, '15:02'), par: 'khalid@x.fr', vu: true, applique: true } });
  if (PHOTO) {
    await put('preuves/ph1', { prestataireId: 'roig', plaque: 'FT-219-ZB', data: PHOTO, at: at(0, '09:41') });
    await put('preuves/ph2', { prestataireId: 'khalid', plaque: 'GM-640-EF', data: PHOTO, at: at(0, '07:30') });
  }
  await put('signalements/p1', { demandeId: 'a6', plaque: 'GF-913-RS', prestataireId: 'khalid', type: 'autre', texte: 'Rayure profonde sur la porte arrière droite', ...(PHOTO ? { photo: 'ph1' } : {}), statut: 'nouveau', at: at(0, '09:50'), par: 'khalid@x.fr' });
  await put('signalements/f1', { demandeId: '', source: 'terrain', plaque: 'GM-640-EF', prestataireId: 'khalid', type: 'autre', quoi: ['Pare-brise', 'Rétro cassé'], texte: 'Pare-brise, Rétro cassé – impact côté conducteur', ...(PHOTO ? { photo: 'ph2' } : {}), statut: 'nouveau', at: at(0, '07:31'), par: 'khalid@x.fr' });
  await put('signalements/f2', { demandeId: '', source: 'terrain', plaque: 'GN-205-XY', prestataireId: 'dsat', type: 'autre', quoi: ['Voyant allumé'], texte: 'Voyant allumé', statut: 'nouveau', at: at(-1, '17:20'), par: 'dsat@x.fr', modifieAt: at(-1, '17:35') });
  await put('signalements/f3', { demandeId: '', source: 'terrain', plaque: 'GP-118-ZZ', prestataireId: 'khalid', type: 'autre', quoi: ['Véhicule sale'], texte: 'Véhicule sale', statut: 'traite', at: at(-1, '16:10'), par: 'khalid@x.fr', traiteAt: at(-1, '17:00'), traitePar: 'fabian@city-drop.com' });
  // « Déjà traités » comme sur la capture de Fabian : surtout du pare-brise, plus un peu de tout.
  const done = [['GN-704-QF', 'pare-brise', 'Allo Pare-Brise', 'confirme', 'Gennevilliers'], ['HJ-308-FZ', 'pare-brise', 'Allo Pare-Brise', 'confirme', 'Saint-Cloud'],
    ['HH-993-YF', 'pare-brise', 'Allo Pare-Brise', 'confirme', 'Saint-Cloud'], ['HC-921-JQ', 'hayon', 'Roig', 'fait', 'Gennevilliers'],
    ['GL-020-LE', 'intervention', 'Roig', 'fait', 'Saint-Cloud'], ['GM-290-KM', 'lavage', 'Du Sol au Toit', 'fait', 'Gennevilliers'], ['GP-232-FQ', 'lavage', 'Khalid', 'confirme', 'Saint-Cloud']];
  for (const [i, [plaque, service, prestataire, etat, site]] of done.entries())
    await dem('v' + i, { prestataire, service, plaque, site, ...(service === 'intervention' ? { tache: 'Changer le rétroviseur' } : {}), date: day(-2), statut: etat === 'fait' ? 'realisee' : 'confirmee',
      retour: { etat, at: at(i < 2 ? -1 : -5, i < 2 ? '11:35' : '14:21'), par: 'x@x.fr', vu: true, applique: true } });
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
    await p.waitForTimeout(2000);
    await p.evaluate(() => { location.hash = 'retours'; }); await p.waitForTimeout(900);
    return { p, ctx };
  }
  const pre = BEFORE ? 'avant-' : '';
  const shots = [['ordi', { viewport: { width: 1680, height: 940 }, deviceScaleFactor: 1 }], ['portable', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
    ['tel', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }]];
  for (const scheme of ['light', 'dark']) for (const [name, opts] of shots) {
    if (scheme === 'dark' && name === 'portable') continue;
    const { p, ctx } = await open({ ...opts, colorScheme: scheme });
    const s = (n) => p.screenshot({ path: `${OUT}/${pre}${name}-${scheme}-${n}.png` });
    await s('a-traiter');
    await p.click('[data-ret-tab="done"]'); await p.waitForTimeout(500); await s('deja-traites');
    if (!BEFORE && scheme === 'light' && name === 'ordi') {
      // la fiche ouvre toujours la feuille ; « Remettre à traiter » marche toujours
      await p.click('.ret-card[data-ret="d:v0"] .ret-open'); await p.waitForTimeout(700); await s('feuille');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      await p.click('.ret-card[data-ret="d:v1"] [data-ret-act="unseen"]'); await p.waitForTimeout(900);
      const doc = await get('demandes/v1');
      if (doc.fields?.retour?.mapValue?.fields?.vu?.booleanValue) errors.push('Remettre à traiter non enregistré');
    }
    await ctx.close();
  }
  await b.close(); srv.close();
  if (errors.length) { console.log('ERREURS', errors); process.exit(1); }
  console.log('OK fiches retours');
})().catch((e) => { console.error(e); process.exit(1); });
