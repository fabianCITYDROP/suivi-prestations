// Page « Retours » de l'équipe façon iPhone : captures (téléphone clair / sombre, ordinateur) et vrai parcours
// (feuille du détail, photo en grand, « Traité » puis « Annuler », « Vu », « Accepter la date », « Tout ranger »),
// dans les émulateurs Firebase (aucune donnée réelle).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/retours.e2e.js <dossier> [avant]"
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
    await p.evaluate(() => { location.hash = 'retours'; }); await p.waitForTimeout(900);
    return { p, ctx };
  }
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const pre = BEFORE ? 'avant-' : '';
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open({ ...phone, colorScheme: scheme });
    const s = (n, full) => p.screenshot({ path: `${OUT}/${pre}${scheme}-${n}.png`, fullPage: !!full });
    await s('1-retours'); await s('1-retours-long', true);
    if (!BEFORE) {
      await p.click('.ret-card[data-ret="p:p1"]'); await p.waitForTimeout(700); await s('2-feuille-probleme');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      await p.click('.ret-card[data-ret="d:a1"]'); await p.waitForTimeout(700); await s('3-feuille-autre-date');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      await p.click('.ret-card[data-ret="f:f1"]'); await p.waitForTimeout(700); await s('4-feuille-vu-en-passant');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      await p.click('[data-ret-tab="done"]'); await p.waitForTimeout(500); await s('5-deja-traites');
      await p.click('[data-ret-tab="todo"]'); await p.waitForTimeout(400);
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const s = (n, full) => p.screenshot({ path: `${OUT}/${pre}ordi-${n}.png`, fullPage: !!full });
    await s('1-retours'); await s('1-retours-long', true);
    if (!BEFORE) {
      await p.click('.ret-card[data-ret="p:p1"]'); await p.waitForTimeout(700); await s('2-feuille-probleme');
      // Traité depuis la feuille → la carte s'en va, bulle « Annuler »
      await p.click('.ret-sheet [data-ret-act="handled"]'); await p.waitForTimeout(350); await s('3-traite-envol');
      await p.waitForTimeout(500); await s('4-bulle-annuler');
      let doc = await get('signalements/p1');
      if (doc.fields?.statut?.stringValue !== 'traite') errors.push('Traité non enregistré');
      await p.click('#toast .toast-action'); await p.waitForTimeout(900);
      doc = await get('signalements/p1');
      if (doc.fields?.statut?.stringValue !== 'nouveau') errors.push('Annuler (Traité) non enregistré');
      // Accepter la date proposée
      await p.click('.ret-card[data-ret="d:a1"] [data-ret-act="accept"]'); await p.waitForTimeout(900);
      doc = await get('demandes/a1');
      if (doc.fields?.date?.stringValue !== day(2) || doc.fields?.statut?.stringValue !== 'confirmee') errors.push('Accepter la date non enregistré');
      // Vu puis Annuler
      await p.click('.ret-card[data-ret="d:a2"] [data-ret-act="seen"]'); await p.waitForTimeout(900);
      doc = await get('demandes/a2');
      if (doc.fields?.retour?.mapValue?.fields?.vu?.booleanValue !== true) errors.push('Vu non enregistré');
      await p.click('#toast .toast-action'); await p.waitForTimeout(900);
      doc = await get('demandes/a2');
      if (doc.fields?.retour?.mapValue?.fields?.vu?.booleanValue) errors.push('Annuler (Vu) non enregistré');
      // Ranger tous les « pour info »
      await p.click('[data-ret-act="all-info"]'); await p.waitForTimeout(900); await s('5-apres-ranger');
      for (const id of ['a5', 'a6', 'a7', 'a8']) {
        doc = await get('demandes/' + id);
        if (doc.fields?.retour?.mapValue?.fields?.vu?.booleanValue !== true) errors.push('Tout ranger : ' + id + ' pas rangé');
      }
      doc = await get('demandes/a3');
      if (doc.fields?.retour?.mapValue?.fields?.vu?.booleanValue) errors.push('Tout ranger a rangé un retour à décider');
      await p.click('[data-ret-tab="done"]'); await p.waitForTimeout(500); await s('6-deja-traites');
      // la photo en grand
      await p.click('[data-ret-tab="todo"]'); await p.waitForTimeout(300);
      await p.click('.ret-card[data-ret="f:f1"]'); await p.waitForTimeout(1200); await s('7-feuille-photo');
    }
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
