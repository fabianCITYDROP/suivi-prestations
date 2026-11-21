// Captures de l'onglet prestataire « Faits » (téléphone clair/sombre + ordinateur) : liste par jour, Corriger, Problème,
// recherche, choix d'un ancien mois, état vide. Émulateurs Firebase, aucune donnée réelle.
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/faits.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-faits');
const BEFORE = process.argv[3] === 'avant'; // ancien écran : mêmes données, captures de l'onglet seulement
const FS = 'http://127.0.0.1:8080/v1/projects/suivi-prestations/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v }
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: val(obj).mapValue.fields }) })
  .then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); });
const get = (p) => fetch(`${FS}/${p}`, { headers: owner }).then((r) => r.json());
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then((r) => r.json());
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
// Un « fait » n jours avant, à l'heure h:m (heure de Paris approximative : on écrit l'heure locale du conteneur).
const at = (n, h, m) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };
const monthsAgo = (k, dd) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); d.setDate(dd); d.setHours(10, 0, 0, 0); return d; };

const EMAIL = 'khalid@lavage.fr';
const base = { prestataire: 'Khalid', prestataireId: 'khalid', statut: 'realisee' };
const sc = { site: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' };
const au = { site: 'Aulnay', adresse: '12 rue de la Croix Blanche, 93600 Aulnay-sous-Bois' };
const done = (id, n, h, m, o) => put('demandes/' + id, { ...base, date: day(n), debut: '09:00', fin: '12:00', doneAt: at(n, h, m),
  retour: { etat: 'fait', at: at(n, h, m), le: new Date(at(n, h, m)), par: EMAIL }, ...o });
async function seed() {
  await put('comptes/' + EMAIL, { role: 'prestataire', prestataireId: 'khalid', email: EMAIL });
  await put('config/reglages', { prestataires: ['Khalid'], sites: [sc, au].map((s) => ({ nom: s.site, adresse: s.adresse })), flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  await put('prestataires/khalid', { nom: 'Khalid', interventions: true, lavage: true, tarifs: [{ service: 'lavage', cubageMin: null, cubageMax: null, prixHT: 37 }] });
  // Aujourd'hui : un « fait » d'il y a 2 minutes (Corriger encore possible) et un de ce matin.
  const now = new Date(); const justNow = new Date(now.getTime() - 2 * 60000).toISOString();
  await put('demandes/f1', { ...base, ...sc, service: 'lavage', plaque: 'GA-731-PM', modele: 'Renault Master 2023', cubage: 20, date: day(0), debut: '09:00', fin: '12:00', doneAt: justNow, retour: { etat: 'fait', at: justNow, le: new Date(justNow), par: EMAIL } });
  await done('f2', 0, 8, 40, { ...sc, service: 'lavage', plaque: 'FK-402-ZD', modele: 'Peugeot Boxer', cubage: 12 });
  // Hier et avant-hier
  await done('f3', -1, 15, 10, { ...au, service: 'intervention', plaque: 'HD-118-QS', modele: 'Renault Trafic', cubage: 6, tache: 'Changer l\'ampoule du feu arrière gauche' });
  await done('f4', -1, 11, 5, { ...au, service: 'lavage', plaque: 'EZ-655-LM', modele: 'Citroën Jumper', cubage: 17 });
  await done('f5', -1, 9, 30, { ...sc, service: 'lavage', plaque: 'GT-910-AB', modele: 'Renault Master 2023', cubage: 20 });
  await done('f6', -3, 10, 15, { ...sc, service: 'lavage', plaque: 'FN-227-RT', modele: 'Renault Master 2023', cubage: 20 });
  await put('signalements/s1', { demandeId: 'f6', plaque: 'FN-227-RT', prestataireId: 'khalid', type: 'autre', texte: 'Rayure sur la porte latérale droite', statut: 'nouveau', at: at(-3, 10, 20), par: EMAIL });
  await done('f7', -12, 14, 0, { ...au, service: 'lavage', plaque: 'GB-503-KC', modele: 'Peugeot Boxer', cubage: 12 });
  await done('f8', -12, 10, 30, { ...au, service: 'lavage', plaque: 'FR-880-HY', modele: 'Citroën Jumper', cubage: 17 });
  // Il y a deux mois : chargé seulement à la demande
  for (const [i, dd, plaque] of [[1, 4, 'EK-114-PL'], [2, 9, 'FD-672-WA'], [3, 9, 'GC-019-NB'], [4, 17, 'EY-345-TS']]) {
    const d = monthsAgo(2, dd); const ts = d.toISOString();
    await put('demandes/o' + i, { ...base, ...(i % 2 ? sc : au), service: 'lavage', plaque, modele: 'Renault Master 2023', cubage: 20, date: iso(d), debut: '09:00', fin: '12:00', doneAt: ts, retour: { etat: 'fait', at: ts, par: EMAIL } });
  }
  await signUp(EMAIL);
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
    await p.fill('#login input[type=email]', EMAIL); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
    await p.waitForTimeout(1800);
    await p.click('[data-tab="done"]'); await p.waitForTimeout(400);
    return { p, ctx };
  }
  const phone = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const desk = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 };
  const pre = BEFORE ? 'avant-' : '';
  const old = monthsAgo(2, 1); const oldMonth = iso(old).slice(0, 7);
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open({ ...phone, colorScheme: scheme });
    await p.screenshot({ path: `${OUT}/${pre}${scheme}-1-faits.png` });
    await p.screenshot({ path: `${OUT}/${pre}${scheme}-1-faits-long.png`, fullPage: true });
    if (!BEFORE) {
      await p.click('[data-act="undo"][data-id="f1"]'); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/${scheme}-2-feuille-corriger.png` });
      await p.click('.sheet-x'); await p.waitForTimeout(500);
      if (scheme === 'light') {
        await p.click('[data-month-more]'); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/light-3-feuille-mois.png` });
        await p.click(`.month-sheet [data-month-pick="${oldMonth}"]`); await p.waitForTimeout(1500);
        await p.screenshot({ path: `${OUT}/light-4-ancien-mois.png` });
        if ((await p.$$('.done-item')).length !== 4) errors.push('Ancien mois : 4 lignes attendues, ' + (await p.$$('.done-item')).length);
        await p.fill('[data-search]', 'ZZ-999'); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/light-5-recherche-vide.png` });
        await p.fill('[data-search]', ''); await p.click('[data-month-pick=""]'); await p.waitForTimeout(400);
        if ((await p.$$('.done-item')).length !== 8) errors.push('40 derniers jours : 8 lignes attendues');
      }
    } else {
      await p.fill('[data-month]', oldMonth); await p.dispatchEvent('[data-month]', 'change'); await p.waitForTimeout(1500);
      await p.screenshot({ path: `${OUT}/avant-${scheme}-4-ancien-mois.png` });
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open(desk);
    await p.screenshot({ path: `${OUT}/${pre}ordi-1-faits.png` });
    if (!BEFORE) {
      await p.click('[data-act="undo"][data-id="f1"]'); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/ordi-2-feuille-corriger.png` });
      // Parcours réel : Corriger, vérifier l'écriture (le véhicule revient à faire).
      await p.click('[data-asend]'); await p.waitForTimeout(1600);
      const doc = await get('demandes/f1');
      if (doc.fields?.retour?.mapValue?.fields?.etat?.stringValue !== 'erreur') errors.push('Corriger non enregistré : ' + JSON.stringify(doc.fields?.retour));
      await p.screenshot({ path: `${OUT}/ordi-3-apres-corriger.png` });
      await p.click('[data-act="problem"][data-id="f4"]'); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/ordi-4-feuille-probleme.png` });
      await p.fill('[data-asheet] [data-note]', 'Pneu avant droit à plat'); await p.click('[data-asend]'); await p.waitForTimeout(1600);
      await p.screenshot({ path: `${OUT}/ordi-5-apres-probleme.png` });
    }
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
