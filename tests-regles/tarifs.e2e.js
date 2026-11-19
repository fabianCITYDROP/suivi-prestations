// End-to-end check of « Remplir les tarifs connus » against the local emulators (never the real project).
// Run from tests-regles/: npm run tarifs
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
  await p.goto('http://localhost:8765/#reglages'); await p.waitForTimeout(1000);
  ok('button shown with what it will add', (await p.isVisible('#t-known')) && /10 tarifs à ajouter/.test(await p.textContent('#t-known-text')));
  await p.locator('#t-known').scrollIntoViewIfNeeded(); await p.screenshot({ path: process.env.SHOT || '/tmp/tarifs.png' });
  await p.click('#t-known'); await p.waitForTimeout(1500);
  const provs = await list('prestataires');
  const allo = provs.find((x) => x.id === 'allo-pare-brise-78');
  ok('allo has 4 lines', allo && allo.tarifs.arrayValue.values.length === 4);
  ok('5 providers? no, 4 filled (not DHOLLIANDA)', provs.filter((x) => x.tarifs?.arrayValue?.values?.length).length === 4);
  ok('button hidden once done', !(await p.isVisible('#t-known')));
  await p.selectOption('#t-prov', 'ALLO pare-brise 78'); await p.waitForTimeout(300);
  console.log(await p.textContent('#t-list'));
  // The mail robot's account can be added from Réglages (role « Robot des mails »).
  await p.fill('#a-email', 'robot-mails@citydrop-suivi.app'); await p.selectOption('#a-role', 'robot'); await p.click('#a-add'); await p.waitForTimeout(800);
  const robot = (await list('comptes')).find((c) => c.id === 'robot-mails@citydrop-suivi.app');
  ok('robot account added with role robot', robot && robot.role === 'robot' && robot.prestataireId === undefined);
  ok('no page error', !p.errs.length); if (p.errs.length) console.log(p.errs);
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
