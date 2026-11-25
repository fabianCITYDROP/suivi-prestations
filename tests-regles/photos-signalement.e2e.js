// Photos des signalements (2026-11-25) : jusqu'à 3 photos allégées (≈ 0,3 Mo), effacées avec le signalement,
// et 40 jours après « Traité » (le texte reste). Dans les émulateurs Firebase (aucune donnée réelle).
// npx firebase emulators:exec --only firestore,auth --project suivi-prestations "node tests-regles/photos-signalement.e2e.js <dossier>"
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'captures-photos-signalement');
const FS = 'http://127.0.0.1:8080/v1/projects/suivi-prestations/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v }
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: val(obj).mapValue.fields }) })
  .then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); });
const get = (p) => fetch(`${FS}/${p}`, { headers: owner }).then((r) => (r.ok ? r.json() : null));
const list = (c) => fetch(`${FS}/${c}?pageSize=300`, { headers: owner }).then((r) => r.json()).then((j) => j.documents || []);
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then((r) => r.json());
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const at = (n, hm) => `${day(n)}T${hm}:00.000Z`;
const PHOTO = fs.readFileSync(path.join(__dirname, 'exemple-photo.b64'), 'utf8').trim();

async function seed() {
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('comptes/khalid@lavage.fr', { role: 'prestataire', prestataireId: 'khalid', email: 'khalid@lavage.fr' });
  await put('config/reglages', { prestataires: ['Khalid'], sites: [{ nom: 'Saint-Cloud', adresse: 'Quai Carnot' }], flotte: [{ modele: 'Renault Master 2023', cubage: 20 }] });
  await put('prestataires/khalid', { nom: 'Khalid', interventions: true, tarifs: [] });
  await put('demandes/r1', { prestataire: 'Khalid', prestataireId: 'khalid', service: 'lavage', plaque: 'GA-731-PM', modele: 'Renault Master 2023', cubage: 20, site: 'Saint-Cloud', date: day(0), debut: '09:00', fin: '12:00', statut: 'confirmee', prixHT: 37 });
  // Traité il y a 60 jours, avec 2 photos : elles partent, le texte reste. Traité il y a 10 jours : rien ne bouge.
  for (const k of ['old_a', 'old_b', 'recent_a', 'single_a']) await put('preuves/sig_' + k, { prestataireId: 'khalid', plaque: 'HB-550-TR', data: PHOTO, at: at(-70, '08:00') });
  const base = { demandeId: '', source: 'terrain', plaque: 'HB-550-TR', prestataireId: 'khalid', type: 'autre', quoi: ['Carrosserie'], texte: 'Carrosserie – rayure', par: 'khalid@lavage.fr', traitePar: 'fabian@city-drop.com' };
  await put('signalements/vieux', { ...base, statut: 'traite', at: at(-70, '08:00'), traiteAt: at(-60, '09:00'), photos: ['sig_old_a', 'sig_old_b'] });
  await put('signalements/vieuxUne', { ...base, statut: 'traite', at: at(-80, '08:00'), traiteAt: at(-50, '09:00'), photo: 'sig_single_a' });
  await put('signalements/recent', { ...base, statut: 'traite', at: at(-12, '08:00'), traiteAt: at(-10, '09:00'), photos: ['sig_recent_a'] });
  await signUp('fabian@city-drop.com'); await signUp('khalid@lavage.fr');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await seed();
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? r.end(fs.readFileSync(f)) : (r.statusCode = 404, r.end());
  }).listen(8765);
  const b = await chromium.launch();
  const errors = [];
  const check = (ok, msg) => { if (!ok) errors.push(msg); };
  // 3 « photos de téléphone » lourdes : 4000×3000, pleines de détails (le pire cas pour la compression).
  const files = [];
  {
    const p = await (await b.newContext()).newPage();
    for (let i = 0; i < 4; i++) {
      const b64 = await p.evaluate((seed) => {
        const c = document.createElement('canvas'); c.width = 4000; c.height = 3000; const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 4000, 3000); grad.addColorStop(0, `hsl(${seed * 70},60%,60%)`); grad.addColorStop(1, '#223');
        g.fillStyle = grad; g.fillRect(0, 0, 4000, 3000);
        const img = g.getImageData(0, 0, 4000, 3000); for (let k = 0; k < img.data.length; k += 4) { const n = (Math.random() - 0.5) * 60; img.data[k] += n; img.data[k + 1] += n; img.data[k + 2] += n; }
        g.putImageData(img, 0, 0); g.fillStyle = '#fff'; g.font = 'bold 400px sans-serif'; g.fillText('Photo ' + (seed + 1), 600, 1700);
        return c.toDataURL('image/jpeg', 0.92).split(',')[1];
      }, i);
      const f = path.join(OUT, `photo-${i + 1}.jpg`); fs.writeFileSync(f, Buffer.from(b64, 'base64')); files.push(f);
    }
    console.log('photo de test :', Math.round(fs.statSync(files[0]).size / 1024), 'Ko');
  }
  async function open(email, opts) {
    const ctx = await b.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', ...opts });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(email + ': ' + e.message));
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
    await p.waitForTimeout(1800);
    return { p, ctx };
  }
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

  // 1. Le prestataire : « Signaler » avec 4 photos choisies d'un coup → 3 gardées, légères.
  for (const scheme of ['light', 'dark']) {
    const { p, ctx } = await open('khalid@lavage.fr', { ...phone, colorScheme: scheme });
    const s = (n) => p.screenshot({ path: `${OUT}/${scheme}-${n}.png` });
    await p.click('[data-sheet-open]'); await p.waitForTimeout(700);
    await p.fill('[data-fplate]', scheme === 'light' ? 'GH-482-KL' : 'GH-483-KL');
    await p.click('[data-fissue][data-q="Carrosserie"]');
    await p.setInputFiles('[data-fphoto]', files);
    await p.waitForSelector('.sheet-ph:nth-child(3)', { timeout: 20000 }); await p.waitForTimeout(300);
    check(!(await p.$('[data-fphoto]')), 'encore « Ajouter » avec 3 photos');
    await p.evaluate(() => document.querySelector('.sheet-photos')?.scrollIntoView({ block: 'center' })); await p.waitForTimeout(300);
    await s('1-trois-photos');
    if (scheme === 'light') {
      await p.click('[data-fphoto-remove="1"]'); await p.waitForTimeout(300);
      check((await p.$$('.sheet-ph')).length === 2, 'retirer une photo');
      await s('2-une-retiree');
      await p.setInputFiles('[data-fphoto]', [files[3]]); await p.waitForSelector('.sheet-ph:nth-child(3)', { timeout: 20000 });
    }
    await p.click('[data-fsend]'); await p.waitForTimeout(2500);
    await ctx.close();
  }
  const reports = (await list('signalements')).map((d) => ({ id: d.name.split('/').pop(), f: d.fields }));
  const sent = reports.find((r) => r.f.plaque?.stringValue === 'GH-482-KL');
  const keys = (sent?.f.photos?.arrayValue?.values || []).map((v) => v.stringValue);
  check(keys.length === 3, `3 photos enregistrées (trouvé ${keys.length})`);
  for (const k of keys) {
    const doc = await get('preuves/' + k);
    const n = doc?.fields?.data?.stringValue?.length || 0;
    console.log('photo enregistrée', k, Math.round(n / 1024), 'Ko');
    check(n > 0 && n <= 300000, `photo ${k} trop lourde : ${n}`);
  }

  // 2. Il modifie le signalement : retire une photo → elle est effacée de la base.
  {
    const { p, ctx } = await open('khalid@lavage.fr', phone);
    await p.click('[data-sheet-open]'); await p.waitForTimeout(700);
    await p.click(`[data-fedit="${sent.id}"]`); await p.waitForTimeout(500);
    check((await p.$$('.sheet-ph')).length === 3, 'les 3 photos à la modification');
    await p.screenshot({ path: `${OUT}/light-3-modifier.png` });
    await p.click('[data-fphoto-remove="0"]'); await p.waitForTimeout(200);
    await p.click('[data-fsend]'); await p.waitForTimeout(2000);
    check(!(await get('preuves/' + keys[0])), 'photo retirée encore dans la base');
    const after = await get('signalements/' + sent.id);
    check((after?.fields?.photos?.arrayValue?.values || []).length === 2, 'il reste 2 photos');
    // Puis le supprime : ses photos partent avec lui.
    await p.click(`[data-fedit="${sent.id}"]`); await p.waitForTimeout(400);
    await p.click(`[data-pdel="${sent.id}"]`); await p.waitForTimeout(200); await p.click(`[data-pdel="${sent.id}"]`); await p.waitForTimeout(1800);
    check(!(await get('signalements/' + sent.id)), 'signalement non supprimé');
    for (const k of keys.slice(1)) check(!(await get('preuves/' + k)), `photo ${k} restée après suppression`);
    await ctx.close();
  }

  // 3. L'équipe : la fiche montre les 3 photos ; à l'ouverture, les photos traitées depuis plus de 40 jours sont effacées.
  for (const [name, opts] of [['tel', { ...phone }], ['ordi', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }]]) {
    const { p, ctx } = await open('fabian@city-drop.com', opts);
    await p.evaluate(() => { location.hash = 'retours'; }); await p.waitForTimeout(1200);
    const other = reports.find((r) => r.f.plaque?.stringValue === 'GH-483-KL');
    const card = `[data-ret-open="p:${other.id}"], [data-ret-open="f:${other.id}"]`;
    await p.waitForSelector(card, { timeout: 5000 }).catch(() => errors.push('fiche du signalement introuvable'));
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${OUT}/equipe-${name}-1-carte.png` });
    await p.click(card); await p.waitForTimeout(1500);
    check((await p.$$('.ret-sh-photos .ret-sh-photo')).length === 3, 'fiche équipe : 3 photos');
    await p.screenshot({ path: `${OUT}/equipe-${name}-2-fiche.png` });
    await p.waitForTimeout(name === 'ordi' ? 7000 : 0); // l'effacement part 8 s après l'ouverture
    await ctx.close();
  }
  await new Promise((r) => setTimeout(r, 1000));
  const vieux = await get('signalements/vieux');
  check(vieux?.fields?.photosEffacees?.booleanValue === true, 'vieux : photos non marquées effacées');
  check(vieux?.fields?.texte?.stringValue === 'Carrosserie – rayure', 'vieux : le texte doit rester');
  check(!(await get('preuves/sig_old_a')) && !(await get('preuves/sig_old_b')), 'vieux : photos encore là');
  check(!(await get('preuves/sig_single_a')), 'ancien format (une photo) : encore là');
  check(!!(await get('preuves/sig_recent_a')), 'traité il y a 10 jours : la photo doit rester');
  {
    const { p, ctx } = await open('fabian@city-drop.com', phone);
    await p.evaluate(() => { location.hash = 'retours'; }); await p.waitForTimeout(1000);
    await p.click('[data-ret-tab="done"]'); await p.waitForTimeout(500);
    const c = await p.$('[data-ret-open="f:vieux"], [data-ret-open="p:vieux"]');
    if (c) { await c.click(); await p.waitForTimeout(800); check(!!(await p.$('.ret-sh-erased')), 'mention « Photo effacée » absente'); await p.screenshot({ path: `${OUT}/equipe-tel-3-photo-effacee.png` }); }
    else console.log('(vieux signalement hors des 40 derniers jours : pas affiché dans Déjà traités)');
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS\n' + errors.join('\n') : 'OK photos des signalements');
  await b.close(); srv.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
