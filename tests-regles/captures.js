// Screenshots of every screen with realistic data, against the local Firebase emulators (never the real project).
// Used to review the design: node captures.js <output folder>, inside `firebase emulators:exec --only firestore,auth`.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures');
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
const at = (n, hm) => `${day(n)}T${hm}:00.000Z`;

const SITES = [
  { nom: 'Saint-Cloud', adresse: 'Parking Indigo, quai du Président Carnot, 92210 Saint-Cloud' },
  { nom: 'La Défense', adresse: '4 place de la Défense, 92400 Courbevoie' },
  { nom: 'Aulnay', adresse: '12 rue Jacques Duclos, 93600 Aulnay-sous-Bois' },
  { nom: 'Coignières', adresse: 'ZA du Pont d\'Aulneau, 78310 Coignières' },
  { nom: 'Paris-Centre', adresse: '18 rue de la Banque, 75002 Paris' },
];
const FLEET = [
  { modele: 'Renault Master 2023', cubage: 20 }, { modele: 'Opel Movano 2023', cubage: 17 }, { modele: 'Opel Movano 2023', cubage: 12 },
  { modele: 'Opel Vivaro 2023', cubage: 5 }, { modele: 'Fiat Ducato 2024', cubage: 14 },
];
const PROVIDERS = ['ALLO pare-brise 78', 'Khalid', 'Du sol au toit', 'Roag'];

async function seed() {
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('comptes/khalid@lavage.fr', { role: 'prestataire', prestataireId: 'khalid', email: 'khalid@lavage.fr' });
  await put('comptes/jerome@city-drop.com', { role: 'lecture', email: 'jerome@city-drop.com' });
  await put('config/reglages', { prestataires: PROVIDERS, sites: SITES, flotte: FLEET });
  await put('prestataires/allo-pare-brise-78', { nom: 'ALLO pare-brise 78', tarifs: [{ service: 'pare-brise', cubageMin: 12, cubageMax: 20, prixHT: 300 }, { service: 'pare-brise', cubageMin: null, cubageMax: 11, prixHT: 240 }] });
  await put('prestataires/khalid', { nom: 'Khalid', interventions: true, tarifs: [{ service: 'lavage', cubageMin: null, cubageMax: null, prixHT: 37 }] });
  await put('prestataires/du-sol-au-toit', { nom: 'Du sol au toit', tarifs: [{ service: 'lavage', cubageMin: null, cubageMax: null, prixHT: 40 }] });
  await put('prestataires/roag', { nom: 'Roag', interventions: true, tarifs: [] });
  const base = (o) => ({ debut: '08:30', fin: '19:30', statut: 'a_envoyer', ...o, prestataireId: o.prestataire.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') });
  const rows = [
    base({ id: 'r1', prestataire: 'ALLO pare-brise 78', service: 'pare-brise', plaque: 'GH-482-KL', modele: 'Renault Master 2023', cubage: 20, site: 'Saint-Cloud', adresse: SITES[0].adresse, date: day(0), statut: 'confirmee', prixHT: 300 }),
    base({ id: 'r2', prestataire: 'ALLO pare-brise 78', service: 'pare-brise', plaque: 'FT-219-ZB', modele: 'Opel Movano 2023', cubage: 17, site: 'Saint-Cloud', adresse: SITES[0].adresse, date: day(0), dateFin: day(2), statut: 'envoyee', prixHT: 300 }),
    base({ id: 'r3', prestataire: 'Khalid', service: 'lavage', plaque: 'GA-731-PM', modele: 'Opel Movano 2023', cubage: 12, site: 'La Défense', adresse: SITES[1].adresse, date: day(0), debut: '09:00', fin: '12:00', statut: 'confirmee', prixHT: 37, groupe: 'g1' }),
    base({ id: 'r4', prestataire: 'Khalid', service: 'lavage', plaque: 'GA-732-PM', modele: 'Opel Movano 2023', cubage: 12, site: 'La Défense', adresse: SITES[1].adresse, date: day(0), debut: '09:00', fin: '12:00', statut: 'confirmee', prixHT: 37, groupe: 'g1' }),
    base({ id: 'r5', prestataire: 'Khalid', service: 'lavage', plaque: 'EZ-104-QS', modele: 'Renault Master 2023', cubage: 20, site: 'La Défense', adresse: SITES[1].adresse, date: day(0), statut: 'realisee', prixHT: 37, doneAt: at(0, '10:40'),
      retour: { etat: 'fait', at: at(0, '10:40'), par: 'khalid@lavage.fr', applique: true } }),
    base({ id: 'r6', prestataire: 'Roag', service: 'intervention', tache: 'AdBlue', plaque: 'HB-550-TR', modele: 'Fiat Ducato 2024', cubage: 14, site: 'Aulnay', adresse: SITES[2].adresse, date: day(0) }),
    base({ id: 'r7', prestataire: 'Du sol au toit', service: 'lavage', plaque: 'FK-903-LD', modele: 'Opel Vivaro 2023', cubage: 5, site: 'Paris-Centre', adresse: SITES[4].adresse, date: day(1), statut: 'envoyee', prixHT: 40,
      retour: { etat: 'autre-date', date: day(3), debut: '14:00', note: 'complet jeudi matin', at: at(0, '08:12'), par: 'contact@dusolautoit.fr' } }),
    base({ id: 'r8', prestataire: 'ALLO pare-brise 78', service: 'pare-brise', plaque: 'GC-618-VA', modele: 'Opel Movano 2023', cubage: 12, site: 'Coignières', adresse: SITES[3].adresse, date: day(1), prixHT: 300 }),
    base({ id: 'r9', prestataire: 'Khalid', service: 'lavage', plaque: 'GD-207-NF', modele: 'Renault Master 2023', cubage: 20, site: 'Saint-Cloud', adresse: SITES[0].adresse, date: day(2), statut: 'envoyee', prixHT: 37,
      retour: { etat: 'absent', note: 'pas sur le parking à 9h', at: at(0, '09:20'), par: 'khalid@lavage.fr' } }),
    base({ id: 'r10', prestataire: 'Roag', service: 'intervention', tache: 'Changer une ampoule', plaque: 'HC-114-WE', modele: 'Renault Master 2023', cubage: 20, site: 'Saint-Cloud', adresse: SITES[0].adresse, date: day(3), statut: 'envoyee',
      retour: { etat: 'refuse', note: 'pièce indisponible', at: at(0, '07:55'), par: 'roag@exemple.fr' } }),
    base({ id: 'r11', prestataire: 'ALLO pare-brise 78', service: 'pare-brise', plaque: 'DX-842-BT', modele: 'Opel Movano 2023', cubage: 17, site: 'Aulnay', adresse: SITES[2].adresse, date: day(-2), statut: 'realisee', prixHT: 300, doneAt: at(-2, '15:00') }),
    base({ id: 'r12', prestataire: 'Khalid', service: 'lavage', plaque: 'EV-390-HU', modele: 'Opel Vivaro 2023', cubage: 5, site: 'Saint-Cloud', adresse: SITES[0].adresse, date: day(-1), statut: 'realisee', prixHT: 37, doneAt: at(-1, '11:00'),
      retour: { etat: 'fait', at: at(-1, '11:00'), par: 'khalid@lavage.fr', applique: true, vu: true } }),
    base({ id: 'r13', prestataire: 'ALLO pare-brise 78', service: 'pare-brise', plaque: 'FB-276-CC', modele: 'Renault Master 2023', cubage: 20, site: 'La Défense', adresse: SITES[1].adresse, date: day(4), statut: 'annulee', prixHT: 300 }),
    base({ id: 'r14', prestataire: 'Khalid', service: 'lavage', plaque: 'GE-555-RR', modele: 'Fiat Ducato 2024', cubage: 14, site: 'Coignières', adresse: SITES[3].adresse, date: day(5), prixHT: 37 }),
  ];
  for (const { id, ...r } of rows) await put('demandes/' + id, { ...r, createdAt: at(-3, '08:00'), updatedAt: at(0, '06:00') });
  for (const v of rows) await put('vehicules/' + v.plaque.replace(/-/g, ''), { plaque: v.plaque, modele: v.modele, cubage: v.cubage });
  await signUp('fabian@city-drop.com'); await signUp('khalid@lavage.fr');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await seed();
  const srv = http.createServer((q, r) => {
    if (q.url.startsWith('/__fonts/')) { r.setHeader('Content-Type', 'font/woff2'); return r.end(fs.readFileSync(path.join(process.env.FONT_DIR, q.url.slice(9).replace(/\//g, '_')))); }
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8765);
  const b = await chromium.launch();
  const errors = [];
  async function open(email, viewport) {
    const p = await b.newPage({ viewport });
    p.on('pageerror', (e) => errors.push(email + ': ' + e.message));
    await p.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ contentType: 'text/javascript',
      body: fs.readFileSync(path.join(process.env.FB_DIR || path.join(__dirname, 'node_modules/firebase'), r.request().url().split('/').pop())) }));
    // Fonts: a local copy when FONT_DIR holds one (fonts.css + files), otherwise none.
    const fontDir = process.env.FONT_DIR;
    await p.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css',
      body: fontDir ? fs.readFileSync(path.join(fontDir, 'fonts.css'), 'utf8').replace(/LOCALFONT\//g, 'http://localhost:8765/__fonts/') : '' }));
    await p.addInitScript(() => {
      let fb; Object.defineProperty(window, 'firebase', { configurable: true, get: () => fb, set: (v) => {
        fb = v; const init = v.initializeApp.bind(v);
        v.initializeApp = (c) => { const app = init(c); v.firestore().useEmulator('127.0.0.1', 8080); v.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); return app; };
      } });
    });
    await p.goto('http://localhost:8765/'); await p.waitForSelector('#login input');
    await p.fill('#login input[type=email]', email); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button');
    await p.waitForTimeout(1800);
    return p;
  }
  const VIEWS = (process.env.VIEWS || 'planning,retours,demande,photos,verif,bilan,historique,reglages').split(',');
  for (const [label, viewport] of [['bureau', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const p = await open('fabian@city-drop.com', viewport);
    for (const v of VIEWS) {
      await p.evaluate((h) => { location.hash = h; }, v); await p.waitForTimeout(400);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) errors.push(`${label}-${v}: page ${overflow}px wider than the screen`);
      await p.screenshot({ path: `${OUT}/${label}-${v}.png`, fullPage: label === 'bureau' });
      if (label === 'mobile') await p.screenshot({ path: `${OUT}/long-${label}-${v}.png`, fullPage: true });
    }
    await p.evaluate(() => { location.hash = 'planning'; }); await p.waitForTimeout(300);
    await p.click('#navMore summary'); await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/${label}-menu-plus.png` });
    await p.close();
  }
  if (!process.env.SKIP_PROVIDER) {
    const k = await open('khalid@lavage.fr', { width: 390, height: 844 });
    await k.screenshot({ path: `${OUT}/mobile-prestataire.png`, fullPage: true });
  }
  console.log(errors.length ? 'PAGE ERRORS\n' + errors.join('\n') : 'no page errors');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
