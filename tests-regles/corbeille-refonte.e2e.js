// Page « Corbeille » de l'équipe façon iPhone : captures (téléphone clair / sombre, ordinateur) et vrai parcours
// (feuille du détail, recherche de plaque, « Restaurer » + bulle « Voir au planning », compte en lecture seule),
// dans les émulateurs Firebase (aucune donnée réelle).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/corbeille-refonte.e2e.js <dossier> [avant <dossier du site>]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const BEFORE = process.argv[3] === 'avant'; // seulement les captures de l'ancienne page (site servi depuis argv[4])
const ROOT = BEFORE && process.argv[4] ? path.resolve(process.argv[4]) : path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-corbeille');
const FS = 'http://127.0.0.1:8080/v1/projects/suivi-prestations/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v }
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: val(obj).mapValue.fields }) })
  .then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); });
const exists = (p) => fetch(`${FS}/${p}`, { headers: owner }).then((r) => r.ok);
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then((r) => r.json());
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ago = (days, h = 0) => new Date(Date.now() - days * 864e5 - h * 36e5);
const check = (ok, what) => { if (!ok) { console.error('ÉCHEC : ' + what); process.exitCode = 1; } else console.log('ok : ' + what); };

async function seed() {
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('comptes/jerome@city-drop.com', { role: 'lecture', email: 'jerome@city-drop.com' });
  const P = { khalid: 'Khalid', allo: 'Allo Pare-Brise', gael: 'Gaël', roig: 'Roig', dsat: 'Du Sol au Toit' };
  await put('config/reglages', { prestataires: Object.values(P), sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' }, { nom: 'Gennevilliers', adresse: '12 rue du Port, 92230 Gennevilliers' }, { nom: 'Bordeaux Lac', adresse: 'Av. des 40 Journaux, 33300 Bordeaux' }],
    flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  for (const [id, nom] of Object.entries(P)) await put('prestataires/' + id, { nom, interventions: true, tarifs: [] });
  const base = { modele: 'Renault Master 2023', cubage: 20, site: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud', debut: '09:00', fin: '12:00', statut: 'envoyee', createdAt: ago(4).toISOString() };
  const d = (o) => ({ ...base, ...o, prestataireId: Object.keys(P).find((k) => P[k] === o.prestataire), dateFin: o.dateFin || o.date });
  const T = (id, demande, when, par) => put('corbeille/' + id, { demande, supprimeLe: when, supprimePar: par });
  // Aujourd'hui : un lavage groupé de 3 véhicules et un pare-brise.
  for (const [i, plaque, debut] of [[1, 'GA-731-PM', '08:30'], [2, 'GB-118-KD', '10:00'], [3, 'GC-905-LT', '11:30']])
    await T('g' + i, d({ prestataire: 'Khalid', service: 'lavage', formule: 'complet', plaque, debut, fin: '19:00', date: day(2), prixHT: 42, groupe: 'G1' }), ago(0, 1), 'fabian@city-drop.com');
  await T('pb1', d({ prestataire: 'Allo Pare-Brise', service: 'pare-brise', plaque: 'GD-207-NF', date: day(3), prixHT: 360, notes: 'Impact côté conducteur' }), ago(0, 3), 'micha@city-drop.com');
  // Hier : une intervention.
  await T('in1', d({ prestataire: 'Roig', service: 'intervention', tache: 'Changer le rétroviseur droit', plaque: 'FT-219-ZB', site: 'Gennevilliers', adresse: '12 rue du Port, 92230 Gennevilliers', date: day(1), prixHT: 85, statut: 'confirmee' }), ago(1), 'jerome@city-drop.com');
  // Il y a 6 jours, 17 jours (orange) et 19 jours et demi (rouge, effacée demain).
  await T('lv2', d({ prestataire: 'Gaël', service: 'lavage', formule: 'exterieur', plaque: 'GE-402-LM', site: 'Bordeaux Lac', adresse: 'Av. des 40 Journaux, 33300 Bordeaux', date: day(-5), prixHT: 37 }), ago(6), 'fabian@city-drop.com');
  await T('lv3', d({ prestataire: 'Du Sol au Toit', service: 'lavage', formule: 'complet', plaque: 'QR-654-ST', date: day(-16), prixHT: 42, statut: 'a_envoyer' }), ago(17), 'jerome@city-drop.com');
  await T('lv4', d({ prestataire: 'Khalid', service: 'lavage', formule: 'complet', plaque: 'HB-550-TR', date: day(-18), prixHT: 42 }), ago(19, 12), 'fabian@city-drop.com');
  for (const e of ['fabian@city-drop.com', 'jerome@city-drop.com']) await signUp(e);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await seed();
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8765);
  const b = await chromium.launch();
  const errors = [];
  async function open(opts, email = 'fabian@city-drop.com') {
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
    await p.fill('#login input[type=email]', email); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
    await p.waitForTimeout(2000);
    await p.evaluate(() => { location.hash = 'corbeille'; }); await p.waitForTimeout(1400);
    return { p, ctx };
  }
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const pre = BEFORE ? 'avant-' : '';

  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open({ ...phone, colorScheme: scheme });
    const s = (n, full) => p.screenshot({ path: `${OUT}/${pre}${scheme}-${n}.png`, fullPage: !!full });
    await s('1-corbeille'); await s('1-corbeille-long', true);
    if (!BEFORE) {
      check(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, `pas de débordement sur téléphone (${scheme})`);
      await p.locator('[data-trash-open="g1,g2,g3"]').click(); await p.waitForTimeout(600);
      await s('2-feuille-groupe');
      await p.keyboard.press('Escape'); await p.waitForTimeout(400);
      await p.locator('[data-trash-open="lv4"]').click(); await p.waitForTimeout(600);
      await s('3-feuille-bientot');
      await p.keyboard.press('Escape'); await p.waitForTimeout(400);
      await p.fill('#trashSearch', 'GD207'); await p.waitForTimeout(300);
      await s('4-recherche');
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const s = (n, full) => p.screenshot({ path: `${OUT}/${pre}ordi-${n}.png`, fullPage: !!full });
    await s('1-corbeille'); await s('1-corbeille-long', true);
    if (!BEFORE) {
      check(await p.locator('.tr-card').count() === 6, '6 cartes (le lavage groupé = une carte)');
      check(await p.locator('.tr-days.soon').count() === 2 && await p.locator('.tr-card .tr-days.bad').count() === 1, 'pastilles : orange à 3 jours, rouge le dernier jour');
      check(await p.locator('.tr-group').count() === 5, "groupes par jour de suppression : aujourd'hui, hier, il y a 6, 17 et 19 jours");
      await p.locator('[data-trash-open="pb1"]').click(); await p.waitForTimeout(600);
      await s('2-feuille');
      // Restaurer depuis la feuille : la demande revient, bulle « Voir au planning ».
      await p.locator('.tr-sheet [data-trash-restore="pb1"]').click(); await p.waitForTimeout(1500);
      check(await exists('demandes/pb1') && !(await exists('corbeille/pb1')), 'le pare-brise revient dans le planning');
      check((await p.textContent('#toast')).includes('Voir au planning'), 'bulle avec « Voir au planning »');
      await s('3-restauree');
      check(await p.locator('.tr-card').count() === 5, 'la carte est retirée');
      await p.locator('#toast .toast-action').click(); await p.waitForTimeout(800);
      check(await p.evaluate(() => location.hash) === '#planning', '« Voir au planning » ouvre le planning');
      await s('4-planning');
      // Le lavage groupé revient entier depuis le bouton de la carte.
      await p.evaluate(() => { location.hash = 'corbeille'; }); await p.waitForTimeout(1400);
      await p.locator('.tr-card [data-trash-restore="g1,g2,g3"]').click(); await p.waitForTimeout(1500);
      check(await exists('demandes/g1') && await exists('demandes/g2') && await exists('demandes/g3'), 'le lavage groupé revient entier');
    }
    await ctx.close();
  }
  if (!BEFORE) {
    const { p, ctx } = await open({ ...phone }, 'jerome@city-drop.com');
    check(await p.locator('.tr-card').count() === 4 && await p.locator('[data-trash-restore]').count() === 0, 'Jérôme (lecture) voit la corbeille sans « Restaurer »');
    await p.screenshot({ path: `${OUT}/light-5-lecture.png` });
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS PAGE\n' + errors.join('\n') : 'aucune erreur dans la page');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
