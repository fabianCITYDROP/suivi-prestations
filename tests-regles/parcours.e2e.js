// End-to-end check of phase 1 against the local Firebase emulators (never the real project).
// Run from tests-regles/ after `npm install`: npm run parcours (Playwright must be installed).
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = process.argv[2] || path.join(__dirname, '..');
const FS = 'http://127.0.0.1:8080/v1/projects/suivi-prestations/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : typeof v === 'number' ? { doubleValue: v } : typeof v === 'string' ? { stringValue: v }
  : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: val(obj).mapValue.fields }) }).then(r => { if (!r.ok) throw new Error(p + ' ' + r.status); });
const unval = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, v.stringValue ?? v.doubleValue ?? (v.integerValue != null ? +v.integerValue : undefined) ?? (v.nullValue === null ? null : v)]));
const list = (c) => fetch(`${FS}/${c}`, { headers: owner }).then(r => r.json()).then(j => (j.documents || []).map(d => ({ id: d.name.split('/').pop(), ...unval(d.fields) })));
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then(r => r.json());
const ok = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' ' + label); if (!cond) process.exitCode = 1; };

(async () => {
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('config/reglages', { prestataires: ['ALLO pare-brise 78'], sites: [{ nom: 'Saint-Cloud', adresse: '1 quai' }] });
  await put('demandes/old1', { prestataire: 'ALLO pare-brise 78', plaque: 'AB-123-CD', service: 'pare-brise', modele: 'Opel Movano 2023', cubage: 17, site: 'Saint-Cloud', date: '2026-11-02', statut: 'envoyee' });
  await signUp('fabian@city-drop.com'); const khalid = await signUp('khalid@lavage.fr');

  const srv = http.createServer((q, r) => { const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end()); }).listen(8765);
  const b = await chromium.launch();
  const page = async () => {
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.errs = errs;
    await p.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ contentType: 'text/javascript',
      body: fs.readFileSync(path.join(process.env.FB_DIR || path.join(__dirname, "node_modules/firebase"), r.request().url().split('/').pop())) }));
    await p.addInitScript(() => {
      let fb; Object.defineProperty(window, 'firebase', { configurable: true, get: () => fb, set: (v) => {
        fb = v; const init = v.initializeApp.bind(v);
        v.initializeApp = (c) => { const app = init(c); v.firestore().useEmulator('127.0.0.1', 8080); v.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); return app; };
      } });
    });
    await p.goto('http://localhost:8765/'); await p.waitForSelector('#login input');
    return p;
  };
  const login = async (p, email) => { await p.fill('#login input[type=email]', email); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button'); await p.waitForTimeout(1500); };

  // 1. Fabian prepares access
  const p = await page(); await login(p, 'fabian@city-drop.com');
  ok('Fabian sees the old request', (await p.textContent('#sync')).includes('1 demande'));
  await p.goto('http://localhost:8765/#reglages'); await p.waitForTimeout(800);
  ok('prepare button shown', await p.isVisible('#a-prepare-btn'));
  await p.fill('#t-min', '12'); await p.fill('#t-max', '20'); await p.fill('#t-prix', '300'); await p.click('#t-add'); await p.waitForTimeout(600);
  ok('price line listed', (await p.textContent('#t-list')).includes('12 à 20 m³'));
  await p.click('#a-prepare-btn'); await p.waitForTimeout(800);
  let rows = await list('demandes');
  ok('old request linked to provider with frozen price', rows[0].prestataireId === 'allo-pare-brise-78' && rows[0].prixHT === 300);
  ok('prepare button hidden afterwards', !(await p.isVisible('#a-prepare-btn')));
  await p.fill('#s-newprov', 'Khalid'); await p.click('#s-addprov'); await p.waitForTimeout(400);
  await p.fill('#a-email', 'Khalid@Lavage.fr'); await p.selectOption('#a-role', 'prestataire'); await p.selectOption('#a-prov', 'Khalid'); await p.click('#a-add'); await p.waitForTimeout(600);
  const accounts = await list('comptes');
  ok('Khalid account stored', accounts.some(a => a.id === 'khalid@lavage.fr' && a.role === 'prestataire' && a.prestataireId === 'khalid'));
  ok('accounts listed in Réglages', (await p.textContent('#a-list')).includes('khalid@lavage.fr'));
  // 2. A new request gets its frozen price
  await p.goto('http://localhost:8765/#planning'); await p.click('#newOnDay'); await p.fill('#f-plaque', 'ef456gh'); await p.dispatchEvent('#f-plaque', 'change');
  await p.selectOption('#f-base', { index: 1 }); await p.dispatchEvent('#f-base', 'change'); await p.waitForTimeout(100);
  const variants = await p.$$eval('#f-modele option', os => os.map(o => o.value + '|' + o.textContent));
  const big = variants.find(v => /1[2-9]|20/.test(v.split('|')[1])); if (big) await p.selectOption('#f-modele', big.split('|')[0]);
  await p.selectOption('#f-site', { index: 1 }); await p.click('#saveBtn'); await p.waitForTimeout(800);
  rows = await list('demandes'); const created = rows.find(r => r.plaque === 'EF-456-GH');
  console.log('     new request:', created && { cubage: created.cubage, prestataireId: created.prestataireId, prixHT: created.prixHT });
  ok('new request has provider id', created?.prestataireId === 'allo-pare-brise-78');
  ok('new request has a price when its cubage has one', created && (created.prixHT === 300 || (created.cubage < 12 && created.prixHT === null)));
  // 2b. A grouped request: two vans at the same place, both saved with the default 8h30–19h30 slot
  await p.goto('http://localhost:8765/#planning'); await p.click('#newOnDay'); await p.waitForTimeout(100);
  ok('new request defaults to 08:30-19:30', (await p.inputValue('#f-debut')) === '08:30' && (await p.inputValue('#f-fin')) === '19:30');
  await p.fill('#f-plaque', 'gr111aa'); await p.dispatchEvent('#f-plaque', 'change');
  await p.selectOption('#f-site', { index: 1 }); await p.click('#addVeh');
  await p.fill('.x-plaque', 'gr222bb'); await p.click('#saveBtn'); await p.waitForTimeout(1000);
  rows = await list('demandes'); const grouped = rows.filter(r => r.plaque === 'GR-111-AA' || r.plaque === 'GR-222-BB');
  ok('grouped request saves both vehicles in one group', grouped.length === 2 && grouped[0].groupe && grouped[0].groupe === grouped[1].groupe && grouped.every(r => r.debut === '08:30' && r.prestataireId && r.statut === 'a_envoyer'));
  // 2b'. The same wash for the same van on the same day is refused
  await p.goto('http://localhost:8765/#planning'); await p.click('#newOnDay'); await p.fill('#f-plaque', 'gr111aa'); await p.dispatchEvent('#f-plaque', 'change');
  await p.selectOption('#f-site', { index: 1 }); await p.click('#saveBtn'); await p.waitForTimeout(700);
  ok('duplicate request refused', (await list('demandes')).filter(r => r.plaque === 'GR-111-AA').length === 1 && (await p.textContent('.toast')).includes('déjà une demande'));
  // 2c. Interventions: hidden for Allo, offered to Khalid once ticked in Réglages
  await p.goto('http://localhost:8765/#planning'); await p.click('#newOnDay'); await p.waitForTimeout(100);
  await p.selectOption('#f-prest', 'ALLO pare-brise 78'); await p.dispatchEvent('#f-prest', 'change');
  ok('no "Intervention" for a windshield-only provider', await p.isHidden('label:has(#svc-intervention)'));
  await p.goto('http://localhost:8765/#reglages'); await p.check('[data-prov-interventions="Khalid"]'); await p.waitForTimeout(800);
  const provs = await list('prestataires');
  ok('interventions saved on Khalid', provs.find(x => x.id === 'khalid')?.interventions?.booleanValue === true);
  await p.goto('http://localhost:8765/#planning'); await p.click('#newOnDay'); await p.selectOption('#f-prest', 'Khalid'); await p.dispatchEvent('#f-prest', 'change');
  await p.click('label:has(#svc-intervention)'); await p.waitForTimeout(100);
  ok('task field shown for an intervention', await p.isVisible('#f-tache'));
  if (process.env.SHOTS) { await p.setViewportSize({ width: 1280, height: 900 }); await (await p.$('#form')).screenshot({ path: process.env.SHOTS + '/6-intervention-equipe.png' }); }
  await p.fill('#f-plaque', 'iv111aa'); await p.selectOption('#f-site', { index: 1 }); await p.fill('#f-tache', 'AdBlue'); await p.click('#saveBtn'); await p.waitForTimeout(900);
  rows = await list('demandes'); const job = rows.find(r => r.plaque === 'IV-111-AA');
  ok('intervention stored with what to do', job?.service === 'intervention' && job.tache === 'AdBlue' && job.prestataireId === 'khalid');
  ok('no page errors (admin)', p.errs.length === 0); if (p.errs.length) console.log(p.errs);

  // 3. Khalid answers from his own screen
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  await put('demandes/lav1', { prestataire: 'Khalid', prestataireId: 'khalid', plaque: 'GH-111-AA', service: 'lavage', modele: 'Opel Movano 2023', cubage: 12, site: 'Saint-Cloud', date: day(1), debut: '09:00', fin: '12:00', statut: 'envoyee', prixHT: 37 });
  await put('demandes/lav2', { prestataire: 'Khalid', prestataireId: 'khalid', plaque: 'GH-222-BB', service: 'lavage', site: 'Saint-Cloud', date: day(1), statut: 'envoyee', prixHT: 37 });
  await put('demandes/lav3', { prestataire: 'Khalid', prestataireId: 'khalid', plaque: 'GH-333-CC', service: 'lavage', modele: 'Renault Master 2023', cubage: 20, site: 'La Défense', date: day(-1), dateFin: day(1), debut: '08:00', fin: '18:00', statut: 'confirmee', prixHT: 37, notes: "Clés à l'accueil" });
  const k = await page(); await k.setViewportSize({ width: 390, height: 860 }); await login(k, 'khalid@lavage.fr');
  await k.waitForSelector('.job');
  const cards = await k.$$eval('.job', (els) => els.map((e) => e.textContent));
  ok('Khalid opens on his requests to validate, nothing from Allo', cards.length === 3 && cards.some((t) => t.includes('AdBlue')) && cards.every((t) => !t.includes('AB-123-CD') && !t.includes('EF-456-GH')));
  ok('team tabs hidden for Khalid', await k.isHidden('nav.tabs'));
  ok('Khalid sees his account card with a sign-out button', (await k.textContent('.presta-account .who b')) === 'Khalid' && await k.isVisible('.presta-account [data-signout]'));
  await k.setViewportSize({ width: 390, height: 844 }); await k.waitForTimeout(150);
  const kbar = await k.evaluate(() => ({ bottom: document.querySelector('.presta-tabs').getBoundingClientRect().bottom, h: innerHeight, wide: document.documentElement.scrollWidth <= innerWidth }));
  ok('phone: provider tabs are a bottom bar, nothing overflows', Math.abs(kbar.bottom - kbar.h) < 1 && kbar.wide);
  if (process.env.SHOTS) await k.screenshot({ path: process.env.SHOTS + '/1-a-valider.png', fullPage: true });
  await k.click('[data-take="lav1"]'); await k.waitForTimeout(1500);
  let lav1 = (await list('demandes')).find((d) => d.id === 'lav1');
  ok('"Accepter" confirms the request (team app applied it)', lav1.statut === 'confirmee');
  await k.click('[data-form="date:lav2"]'); await k.fill('[data-date]', day(3)); await k.fill('[data-time]', '14:00');
  if (process.env.SHOTS) await k.screenshot({ path: process.env.SHOTS + '/2-autre-date.png', fullPage: true });
  await k.click('[data-send="date:lav2"]'); await k.waitForTimeout(1200);
  await k.click('[data-tab="today"]'); await k.waitForTimeout(300);
  ok('vehicle on site for several days shows today', (await k.textContent('#view-presta')).includes('GH-333-CC'));
  if (process.env.SHOTS) await k.screenshot({ path: process.env.SHOTS + '/3-aujourdhui.png', fullPage: true });
  await k.click('[data-tab="upcoming"]'); await k.waitForTimeout(300);
  await k.fill('[data-search]', 'gh-111'); await k.waitForTimeout(300);
  ok('search finds the accepted vehicle', (await k.$$('.job')).length === 1);
  if (process.env.SHOTS) await k.screenshot({ path: process.env.SHOTS + '/4-a-venir.png', fullPage: true });
  const photo = await k.screenshot({ type: 'jpeg', quality: 60 });
  await k.click('[data-done="lav1"]');
  await k.setInputFiles('input[type=file][capture]', { name: 'plaque.jpg', mimeType: 'image/jpeg', buffer: photo });
  await k.waitForTimeout(2500);
  lav1 = (await list('demandes')).find((d) => d.id === 'lav1');
  ok('"Fait en avance" with photo closes the request automatically', lav1.statut === 'realisee');
  const proofs = await list('preuves');
  ok('proof photo stored for Khalid', proofs.length === 1 && proofs[0].prestataireId === 'khalid');
  await k.click('[data-tab="done"]'); await k.waitForTimeout(300);
  ok('done list shown to Khalid', (await k.textContent('#view-presta')).includes('GH-111-AA'));
  if (process.env.SHOTS) await k.screenshot({ path: process.env.SHOTS + '/5-faits.png', fullPage: true });
  ok('no page errors (Khalid)', k.errs.length === 0); if (k.errs.length) console.log(k.errs);

  // 4. The team sees the answers and accepts the new date
  await p.goto('http://localhost:8765/#planning'); await p.waitForTimeout(1200);
  await p.setViewportSize({ width: 1440, height: 900 });
  ok('planning side card lists the new answers', (await p.textContent('#retoursSide')).includes('GH-222-BB'));
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/8-planning-retours.png' });
  ok('Retours tab and window title show the count', /^\d+$/.test(await p.textContent('#retoursBadge')) && /^\(\d+\) /.test(await p.title()));
  await p.click('#retoursSide .side-all'); await p.waitForTimeout(300);
  const panel = await p.textContent('#answers');
  ok('team sees Khalid answers on the Retours page', await p.isVisible('#view-retours') && panel.includes('GH-111-AA') && panel.includes('Autre date proposée'));
  if (process.env.SHOTS) { await p.setViewportSize({ width: 1280, height: 800 }); await p.screenshot({ path: process.env.SHOTS + '/7-retours.png' }); }
  await p.click('#answers [data-proof]'); await p.waitForTimeout(800);
  ok('team opens the proof photo', ((await p.getAttribute('#lightImg', 'src')) || '').startsWith('data:image/jpeg'));
  await p.click('#lightbox');
  await p.click('#answers [data-accept-date="lav2"]'); await p.waitForTimeout(1000);
  const lav2 = (await list('demandes')).find((d) => d.id === 'lav2');
  ok('accepting moves the request to the proposed date and confirms it', lav2.date === day(3) && lav2.debut === '14:00' && lav2.statut === 'confirmee');
  await p.click('#allSeenBtn'); await p.waitForTimeout(800);
  ok('"Tout marquer comme vu" empties the list and the badge', await p.isHidden('#retoursBadge') && (await p.textContent('#answersSeen')).includes('GH-111-AA'));
  // Simplified menu: rare pages under « Plus », the label says which one is open
  await p.click('#navMore summary'); await p.click('#navMore [data-view="bilan"]'); await p.waitForTimeout(200);
  ok('« Plus » opens the monthly report and names it', await p.isVisible('#view-bilan') && (await p.textContent('#navMoreLabel')) === 'Bilan du mois' && (await p.getAttribute('#navMore', 'open')) === null);
  await p.click('[data-view="planning"]'); await p.click('#nextDay'); await p.click('#nextDay'); await p.click('#newOnDay'); await p.waitForTimeout(100);
  ok('« Nouvelle demande » from the planning starts on the day being looked at', (await p.inputValue('#f-date')) === day(2));
  await p.click('[data-view="planning"]'); await p.click('#todayBtn'); await p.waitForTimeout(200);
  ok('day list message is folded behind « Voir le message »', !(await p.isVisible('#dayShare .msg')) && (await p.isVisible('#dayShare [data-copy]')));
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200);
  const bar = await p.evaluate(() => { const r = document.querySelector('nav.tabs').getBoundingClientRect(); return { bottom: r.bottom, h: innerHeight, wide: document.documentElement.scrollWidth <= innerWidth }; });
  ok('phone: menu is a bottom bar and nothing overflows sideways', Math.abs(bar.bottom - bar.h) < 1 && bar.wide);
  await p.setViewportSize({ width: 1440, height: 900 });
  ok('no page errors (team)', p.errs.length === 0); if (p.errs.length) console.log(p.errs);

  // 5. Someone signed in without access
  await signUp('inconnu@exemple.fr'); const u = await page(); await login(u, 'inconnu@exemple.fr');
  ok('unknown account told it has no access', (await u.textContent('#banner')).includes("pas encore d'accès"));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
