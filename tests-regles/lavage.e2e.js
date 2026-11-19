// End-to-end check of the « Lavage » box per provider against the local emulators (never the real project).
// Run from tests-regles/: npm run lavage
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
  await put('config/reglages', { prestataires: ['ALLO pare-brise 78', 'Khalid Lavage', 'DSAT (du sol au toit)', 'ASG BDX LAVAGE', 'DHOLLIANDA'], sites: [{ nom: 'Saint-Cloud', adresse: '1 quai' }] });
  await put('prestataires/dhollianda', { nom: 'DHOLLIANDA', hayon: true });
  await signUp('fabian@city-drop.com');
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
  const p = await page(); await login(p, 'fabian@city-drop.com');
  const shots = process.env.SHOTS || '/tmp';
  await p.goto('http://localhost:8765/#reglages'); await p.waitForTimeout(1200);
  const box = (prov, flag) => p.locator(`[data-prov="${prov}"][data-prov-flag="${flag}"]`);
  ok('Khalid ticked Lavage by default', await box('Khalid Lavage', 'lavage').isChecked());
  ok('DHOLLIANDA not ticked Lavage (tailgate only)', !(await box('DHOLLIANDA', 'lavage').isChecked()));
  await p.locator('#s-provs').scrollIntoViewIfNeeded(); await p.locator('#s-provs').screenshot({ path: shots + '/reglages-ordi.png' });
  // Unticking Lavage for Khalid is saved on its provider document.
  await box('Khalid Lavage', 'lavage').uncheck(); await p.waitForTimeout(1200);
  const khalid = (await list('prestataires')).find((x) => x.id === 'khalid-lavage');
  ok('Khalid lavage=false saved', khalid && khalid.lavage && khalid.lavage.booleanValue === false);
  // New request: DHOLLIANDA only offers the tailgate control, ALLO keeps windshield + wash.
  await p.goto('http://localhost:8765/#planning'); await p.waitForTimeout(800);
  await p.click('#newOnDay'); await p.waitForTimeout(500);
  const shown = async () => p.$$eval('#svcSeg label', (ls) => ls.filter((l) => !l.hidden).map((l) => l.textContent.trim()));
  await p.selectOption('#f-prest', 'DHOLLIANDA'); await p.waitForTimeout(200);
  ok('DHOLLIANDA: only Contrôle hayon', JSON.stringify(await shown()) === '["Contrôle hayon"]');
  await p.selectOption('#f-prest', 'ALLO pare-brise 78'); await p.waitForTimeout(200);
  ok('ALLO: Pare-brise + Lavage', JSON.stringify(await shown()) === '["Pare-brise","Lavage"]');
  await p.selectOption('#f-prest', 'Khalid Lavage'); await p.waitForTimeout(200);
  ok('Khalid unticked: nothing offered + message', (await shown()).length === 0 && await p.isVisible('#svcNone'));
  // Saving is refused with a clear reason.
  await p.fill('#f-plaque', 'AB-123-CD'); await p.click('#form button[type=submit]'); await p.waitForTimeout(600);
  ok('save refused', !(await list('demandes')).length);
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  await p.locator('#provRow').scrollIntoViewIfNeeded(); await p.screenshot({ path: shots + '/formulaire-telephone-rien.png' });
  await p.selectOption('#f-prest', 'DHOLLIANDA'); await p.waitForTimeout(200);
  await p.locator('#provRow').scrollIntoViewIfNeeded(); await p.screenshot({ path: shots + '/formulaire-telephone-dhollianda.png' });
  ok('no page error', !p.errs.length); if (p.errs.length) console.log(p.errs);
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
