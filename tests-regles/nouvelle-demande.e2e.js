// Captures de la page équipe « Nouvelle demande » (téléphone clair/sombre + ordinateur) et parcours réel d'enregistrement,
// dans les émulateurs Firebase (aucune donnée réelle).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/nouvelle-demande.e2e.js <dossier> [avant]"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-nouvelle-demande');
const BEFORE = process.argv[3] === 'avant';
const FS = 'http://127.0.0.1:8080/v1/projects/suivi-prestations/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v }
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: val(obj).mapValue.fields }) })
  .then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); });
const unval = (v) => v == null ? v : 'stringValue' in v ? v.stringValue : 'doubleValue' in v ? v.doubleValue : 'integerValue' in v ? +v.integerValue
  : 'booleanValue' in v ? v.booleanValue : 'nullValue' in v ? null : v;
const list = (c) => fetch(`${FS}/${c}?pageSize=200`, { headers: owner }).then((r) => r.json())
  .then((j) => (j.documents || []).map((d) => ({ id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, unval(v)])) })));
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then((r) => r.json());
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

async function seed() {
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('config/reglages', {
    prestataires: ['ALLO pare-brise 78', 'Khalid', 'DSAT (du sol au toit)', 'DHOLLIANDA'],
    sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud' }, { nom: 'Aulnay', adresse: '12 rue de la Croix Blanche, 93600 Aulnay-sous-Bois' },
      { nom: 'Gennevilliers', adresse: '3 route du Port, 92230 Gennevilliers' }, { nom: 'Montreuil', adresse: '' }],
    flotte: [{ modele: 'Renault Master 2023', cubage: 20 }, { modele: 'Renault Master 2019', cubage: 12 }, { modele: 'Peugeot Boxer', cubage: 12 },
      { modele: 'Renault Trafic', cubage: 6 }, { modele: 'Citroën Jumper', cubage: 17 }],
  });
  await put('prestataires/allo-pare-brise-78', { nom: 'ALLO pare-brise 78', pareBrise: true, lavage: true, interventions: true,
    tarifs: [{ service: 'pare-brise', cubageMin: null, cubageMax: 6, prixHT: 320 }, { service: 'pare-brise', cubageMin: 12, cubageMax: null, prixHT: 360 }] });
  await put('prestataires/khalid', { nom: 'Khalid', lavage: true, interventions: true, tarifs: [{ service: 'lavage', cubageMin: null, cubageMax: null, prixHT: 37 }] });
  await put('prestataires/dsat-du-sol-au-toit', { nom: 'DSAT (du sol au toit)', lavage: true, interventions: false, tarifs: [{ service: 'lavage', cubageMin: null, cubageMax: null, prixHT: 42 }] });
  await put('prestataires/dhollianda', { nom: 'DHOLLIANDA', hayon: true, lavage: false });
  await put('vehicules/GA731PM', { plaque: 'GA-731-PM', modele: 'Renault Master 2023', cubage: 20 });
  await put('demandes/p1', { prestataire: 'Khalid', prestataireId: 'khalid', statut: 'confirmee', service: 'lavage', site: 'Saint-Cloud', adresse: 'Quai Carnot, 92210 Saint-Cloud',
    plaque: 'FK-402-ZD', modele: 'Peugeot Boxer', cubage: 12, date: day(1), dateFin: day(1), debut: '09:00', fin: '12:00', prixHT: 37 });
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
  const ok = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) errors.push(label); };
  async function open(opts) {
    const ctx = await b.newContext(opts);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { console.log('PAGEERR', e.message); errors.push('page: ' + e.message); });
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
    return { p, ctx };
  }
  const phone = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const desk = { locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 };
  const shot = (p, name, full) => p.screenshot({ path: `${OUT}/${BEFORE ? 'avant-' : ''}${name}.png`, fullPage: !!full });

  const scrollTo = async (p, sel) => { await p.$eval(sel, (el) => { const box = document.querySelector('.nd-scroll'); box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8; }); await p.waitForTimeout(300); };
  async function phoneFlow(p, scheme) {
    ok('sheet open over the planning', await p.isVisible('#view-demande .nd-sheet') && await p.isVisible('#view-planning'));
    await p.click('[data-nd-svc="lavage"]'); await p.waitForTimeout(250);
    await p.click('[data-nd-prov="Khalid"]');
    await p.fill('#f-plaque', 'ga731pm'); await p.press('#f-plaque', 'Tab'); await p.waitForTimeout(300);
    await p.click('[data-nd-site="Saint-Cloud"]'); await p.click(`[data-nd-day="${day(2)}"]`); await p.waitForTimeout(300);
    await shot(p, `${scheme}-2-rempli`);
    await scrollTo(p, '#vehLabel'); await shot(p, `${scheme}-3-vehicule-site`);
    await p.click('#addVeh'); await p.waitForTimeout(400); await p.fill('.extra-veh .x-plaque', 'FK-402-ZE'); await p.press('.extra-veh .x-plaque', 'Tab'); await p.waitForTimeout(300);
    await scrollTo(p, '#extraVeh'); await shot(p, `${scheme}-4-deux-vehicules`);
    await scrollTo(p, '#whenLabel'); await shot(p, `${scheme}-5-disponibilite`);
    await scrollTo(p, '#ndSum'); await shot(p, `${scheme}-6-recap-message`);
    if (scheme === 'light') {
      await p.click('[data-nd-close]:not(.nd-scrim)'); await p.waitForTimeout(500);
      ok('closing keeps the planning, bubble offers Reprendre', await p.isHidden('#view-demande') && await p.isVisible('.toast-action'));
      await shot(p, 'light-7-ferme-reprendre');
      await p.click('.toast-action'); await p.waitForTimeout(500);
      ok('Reprendre gives the draft back', (await p.inputValue('#f-plaque')) === 'GA-731-PM');
    }
  }
  async function deskFlow(p) {
    // Pare-brise first: only ALLO does windscreens, so it is chosen on its own; price 360 € HT for 20 m³.
    await p.click('[data-nd-svc="pare-brise"]'); await p.waitForTimeout(300);
    const provs = await p.$$eval('#ndProv [data-nd-prov]', (bs) => bs.map((b) => b.dataset.ndProv));
    ok('pare-brise: only ALLO offered', JSON.stringify(provs) === '["ALLO pare-brise 78"]');
    ok('ALLO chosen', (await p.inputValue('#f-prest')) === 'ALLO pare-brise 78');
    await p.fill('#f-plaque', 'GA-731-PM'); await p.press('#f-plaque', 'Tab'); await p.waitForTimeout(300);
    await p.click('[data-nd-site="Aulnay"]'); await p.click(`[data-nd-day="${day(1)}"]`); await p.click('[data-nd-slot="08:30-12:30"]'); await p.waitForTimeout(300);
    ok('save enabled once complete', (await p.getAttribute('#saveBtn', 'data-ready')) === 'true');
    await shot(p, 'ordi-2-pare-brise');
    await p.click('#saveBtn'); await p.waitForTimeout(1500);
    const pb = (await list('demandes')).find((d) => d.plaque === 'GA-731-PM');
    ok('pare-brise saved with frozen price 360 HT', pb && pb.service === 'pare-brise' && pb.prestataire === 'ALLO pare-brise 78' && pb.prixHT === 360 && pb.site === 'Aulnay' && pb.debut === '08:30' && pb.fin === '12:30' && pb.date === day(1));
    await shot(p, 'ordi-3-enregistree');
    // Grouped wash: two vehicles, same site, DSAT, inside wash.
    await p.click('[data-nd-close]:not(.nd-scrim)'); await p.waitForTimeout(500);
    await p.click('#newOnDay'); await p.waitForTimeout(600);
    await p.click('[data-nd-svc="lavage"]'); await p.click('[data-nd-prov="DSAT (du sol au toit)"]'); await p.check('#wash-interieur', { force: true });
    await p.fill('#f-plaque', 'HD-118-QS'); await p.selectOption('#f-base', { index: 1 }); await p.waitForTimeout(200);
    await p.click('#addVeh'); await p.fill('.extra-veh .x-plaque', 'EZ-655-LM'); await p.press('.extra-veh .x-plaque', 'Tab');
    await p.click('[data-nd-site="Gennevilliers"]'); await p.waitForTimeout(300);
    await shot(p, 'ordi-4-groupe');
    await p.click('#saveBtn'); await p.waitForTimeout(1800);
    const grp = (await list('demandes')).filter((d) => ['HD-118-QS', 'EZ-655-LM'].includes(d.plaque));
    ok('grouped wash: 2 requests, same group, DSAT', grp.length === 2 && grp[0].groupe && grp[0].groupe === grp[1].groupe && grp.every((d) => d.prestataire === 'DSAT (du sol au toit)' && d.formule === 'interieur' && d.site === 'Gennevilliers'));
    // Opening an existing request from the planning: same sheet, edit mode.
    await p.click('[data-nd-close]:not(.nd-scrim)'); await p.waitForTimeout(500);
    await p.evaluate((d) => { const i = document.querySelector('#dayPick'); i.value = d; i.dispatchEvent(new Event('change')); }, day(1)); await p.waitForTimeout(400);
    await p.click('#dayList [data-open="p1"]'); await p.waitForTimeout(600);
    await p.click('[data-plan-edit="p1"]'); await p.waitForTimeout(600); // the Planning card's « Modifier »
    ok('existing request opens in the sheet', (await p.textContent('#formTitle')).includes('FK-402-ZD'));
    await shot(p, 'ordi-5-ouvrir-existante');
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    ok('Escape closes the sheet', await p.isHidden('#view-demande'));
  }
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open({ ...phone, colorScheme: scheme });
    await p.click('#newOnDay'); await p.waitForTimeout(700);
    await shot(p, `${scheme}-1-nouvelle`);
    if (BEFORE) await shot(p, `${scheme}-1-nouvelle-long`, true);
    else await phoneFlow(p, scheme);
    await ctx.close();
  }
  {
    const { p, ctx } = await open(desk);
    await p.click('#newOnDay'); await p.waitForTimeout(700);
    await shot(p, 'ordi-1-nouvelle');
    if (BEFORE) await shot(p, 'ordi-1-nouvelle-long', true);
    else await deskFlow(p);
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'aucune erreur');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
