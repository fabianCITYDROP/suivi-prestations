// Captures de la page Historique de l'équipe (téléphone clair/sombre + ordinateur) : filtres, fiche + frise des modifications, export,
// dans les émulateurs Firebase (aucune donnée réelle).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/historique-page.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = process.env.SITE_ROOT || path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-historique');
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
  const sent = (n) => ({ sentAt: `${day(n)}T17:10:00.000Z`, createdAt: `${day(n)}T16:55:00.000Z`, updatedAt: '2026-01-01T00:00:00Z' });
  const rows = [
    ['h1', dsat, sc, 'lavage', 'GA-731-PM', 'Renault Master 2023', 20, 0, '09:00', '12:00', 'realisee', 42],
    ['h2', dsat, sc, 'lavage', 'FK-402-ZD', 'Opel Movano 2024', 12, 0, '09:00', '12:00', 'confirmee', 37],
    ['h3', allo, sc, 'pare-brise', 'HB-220-KL', 'Renault Master 2023', 20, 0, '13:00', '17:00', 'envoyee', 360],
    ['h4', kh, au, 'intervention', 'HD-118-QS', 'Renault Trafic', 6, -1, '08:00', '18:00', 'confirmee', null],
    ['h5', kh, au, 'lavage', 'EZ-655-LM', 'Citroën Jumper', 17, 1, '14:00', '17:00', 'a_envoyer', 37],
    ['h6', dsat, ld, 'lavage', 'GT-910-AB', 'Renault Master 2023', 20, -2, '10:00', '12:00', 'realisee', 42],
    ['h7', kh, ld, 'intervention', 'FR-377-TT', 'Opel Movano 2024', 12, -2, '08:00', '10:00', 'annulee', null],
    ['h8', dsat, sc, 'lavage', 'GL-554-XC', 'Renault Master 2023', 20, -3, '09:00', '12:00', 'realisee', 42],
    ['h9', allo, au, 'pare-brise', 'GV-118-RB', 'Opel Movano 2024', 12, -3, '09:00', '12:00', 'realisee', 320],
    ['h10', dsat, au, 'lavage', 'FA-090-QD', 'Opel Movano 2024', 12, -5, '08:30', '12:00', 'realisee', 37],
    ['h11', kh, sc, 'lavage', 'GD-207-NF', 'Renault Master 2023', 20, -6, '08:30', '19:30', 'realisee', 37],
  ];
  for (const [id, prov, site, service, plaque, modele, cubage, n, debut, fin, statut, prixHT] of rows)
    await put('demandes/' + id, { ...prov, ...site, service, plaque, modele, cubage, date: day(n), debut, fin, statut, ...(prixHT ? { prixHT } : {}), ...(service === 'intervention' ? { tache: 'Vérifier les pneus' } : {}), ...sent(n - 1) });
  await put('demandes/h4', { ...kh, ...au, service: 'intervention', plaque: 'HD-118-QS', modele: 'Renault Trafic', cubage: 6, date: day(-1), dateFin: day(1), debut: '08:00', fin: '18:00', statut: 'confirmee', tache: "Changer l'ampoule du feu arrière gauche", ...sent(-2) });
  const h = (id, o) => put('historique/' + id, { demandeId: 'h8', plaque: 'GL-554-XC', ...o });
  await h('x1', { action: 'creation', changes: [], par: 'micha@city-drop.com', at: `${day(-5)}T16:55:00.000Z` });
  await h('x2', { action: 'statut', changes: [{ champ: 'statut', avant: 'a_envoyer', apres: 'envoyee' }], par: 'micha@city-drop.com', at: `${day(-4)}T17:10:00.000Z` });
  await h('x3', { action: 'modification', changes: [{ champ: 'date', avant: day(-4), apres: day(-3) }, { champ: 'debut', avant: '13:00', apres: '09:00' }], par: 'fabian@city-drop.com', at: `${day(-4)}T18:02:00.000Z` });
  await h('x4', { action: 'reponse', changes: [{ champ: 'reponse', avant: null, apres: 'fait' }], par: 'dsat@test.fr', at: `${day(-3)}T10:41:00.000Z` });
  await h('x5', { action: 'statut', changes: [{ champ: 'statut', avant: 'confirmee', apres: 'realisee' }], par: 'fabian@city-drop.com', auto: true, at: `${day(-3)}T10:42:00.000Z` });
  await signUp('fabian@city-drop.com');
}

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
    await p.goto('http://localhost:8768/#historique'); await p.waitForSelector('#login input');
    await p.fill('#login input[type=email]', 'fabian@city-drop.com'); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
    await p.waitForTimeout(2000);
    return { p, ctx };
  }
  const phone = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const desk = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 };
  const pre = BEFORE ? 'avant-' : '';
  const shot = (p, name, full) => p.screenshot({ path: `${OUT}/${pre}${name}.png`, fullPage: !!full });
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open({ ...phone, colorScheme: scheme });
    await shot(p, `${scheme}-1-historique`); await shot(p, `${scheme}-1-historique-long`, true);
    if (!BEFORE) {
      await p.click('#histWrap [data-open="h8"]'); await p.waitForTimeout(1200); await shot(p, `${scheme}-2-fiche`);
      await p.evaluate(() => document.querySelector('.team-sheet .sheet-b').scrollTo(0, 9999)); await p.waitForTimeout(200); await shot(p, `${scheme}-3-frise`);
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(500);
      if (scheme === 'light') {
        await p.click('[data-h-more]'); await p.waitForTimeout(600); await shot(p, 'light-4-filtres');
        await p.click('.hist-sheet [data-hs-prest="Du Sol au Toit"]'); await p.waitForTimeout(200);
        await p.click('.hist-sheet [data-team-sheet-close].plan-cta'); await p.waitForTimeout(500);
        await p.click('[data-h-statut="realisee"]'); await p.waitForTimeout(300); await shot(p, 'light-5-filtre-actif');
        const n = await p.locator('#histWrap [data-open]').count();
        if (n !== 4) errors.push('filtre Du Sol au Toit + Réalisées : ' + n + ' lignes au lieu de 4');
        await p.click('[data-h-other]'); await p.waitForTimeout(600); await shot(p, 'light-6-autre-mois');
        await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(400);
        await p.fill('#q', 'ZZZ'); await p.waitForTimeout(300); await shot(p, 'light-7-vide');
        await p.click('[data-h-reset]'); await p.waitForTimeout(300);
        if ((await p.locator('#histWrap [data-open]').count()) !== 11) errors.push('« Effacer » ne remet pas toute la liste');
      }
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ ...desk });
    await shot(p, 'ordi-1-historique'); await shot(p, 'ordi-1-historique-long', true);
    if (!BEFORE) {
      await p.click('#histWrap [data-open="h8"]'); await p.waitForTimeout(1200); await shot(p, 'ordi-2-fiche');
      const tl = await p.locator('.hist-tl > li').count();
      if (tl !== 5) errors.push('frise : ' + tl + ' lignes au lieu de 5');
      // Statut changé depuis la fiche : enregistré, et la frise le montre.
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(400);
      await p.click('#histWrap [data-open="h2"]'); await p.waitForTimeout(900);
      await p.click('.team-sheet [data-plan-status="realisee"]'); await p.waitForTimeout(2500);
      const d2 = await get('demandes/h2');
      if (d2.fields?.statut?.stringValue !== 'realisee') errors.push('Statut non enregistré depuis la fiche : ' + d2.fields?.statut?.stringValue);
      const txt = await p.textContent('.hist-tl');
      if (!txt.includes('Réalisée')) errors.push('la frise ne montre pas le nouveau statut');
      await shot(p, 'ordi-3-fiche-statut');
      await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(400);
      await p.click('#h-export'); await p.waitForTimeout(600); await shot(p, 'ordi-4-exporter');
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.click('.hist-sheet [data-hs-csv]')]);
      if (!dl) errors.push('pas de fichier CSV téléchargé');
      else { const csv = fs.readFileSync(await dl.path(), 'utf8'); if (csv.trim().split('\n').length !== 12) errors.push('CSV : ' + csv.trim().split('\n').length + ' lignes'); }
      await p.click('#histWrap [data-open="h3"]'); await p.waitForTimeout(500); await p.click('.team-sheet [data-plan-edit]'); await p.waitForTimeout(500);
      if (!(await p.isVisible('#view-demande'))) errors.push('« Modifier la demande » n\'ouvre pas le formulaire');
      if (!(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) errors.push('la page déborde sur le côté');
    }
    await ctx.close();
  }
  {
    const { p, ctx } = await open({ ...desk, colorScheme: 'dark' });
    await shot(p, 'ordi-dark-1-historique');
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
