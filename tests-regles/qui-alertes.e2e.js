// End-to-end check of the « qui a activé ses alertes » view in Réglages against the local emulators (never the real project).
// Run from tests-regles/: npm run qui-alertes
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
  await put('comptes/micha@city-drop.com', { role: 'admin', email: 'micha@city-drop.com' });
  await put('comptes/jerome@city-drop.com', { role: 'lecture', email: 'jerome@city-drop.com' });
  await put('comptes/allo@exemple.fr', { role: 'prestataire', prestataireId: 'allo-pare-brise-78', email: 'allo@exemple.fr' });
  await put('comptes/khalid@exemple.fr', { role: 'prestataire', prestataireId: 'khalid-lavage', email: 'khalid@exemple.fr' });
  await put('comptes/asg@exemple.fr', { role: 'prestataire', prestataireId: 'asg-bdx-lavage', email: 'asg@exemple.fr' });
  await put('config/reglages', { prestataires: ['ALLO pare-brise 78', 'Khalid Lavage', 'ASG BDX LAVAGE', 'DHOLLIANDA'], sites: [{ nom: 'Saint-Cloud', adresse: '1 quai' }] });
  const now = new Date().toISOString(); const old = new Date(Date.now() - 90 * 86400000).toISOString();
  const dev = (email, role, extra) => ({ email, role, endpoint: 'https://fcm.googleapis.com/fcm/send/x', jeton: '0123456789abcdef0123456789abcdef', appareil: 'iPhone', createdAt: now, updatedAt: now, ...extra });
  await put('abonnements/f1', dev('fabian@city-drop.com', 'admin'));
  await put('abonnements/a1', dev('allo@exemple.fr', 'prestataire', { prestataireId: 'allo-pare-brise-78', appareil: 'Android' }));
  await put('abonnements/g1', dev('asg@exemple.fr', 'prestataire', { prestataireId: 'asg-bdx-lavage', updatedAt: old }));
  await signUp('fabian@city-drop.com'); await signUp('jerome@city-drop.com');
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
  const shots = process.env.SHOTS || '/tmp';
  const p = await page(); await login(p, 'fabian@city-drop.com');
  await p.goto('http://localhost:8765/#reglages'); await p.waitForTimeout(1500);
  await p.click('[data-rg-open="accounts"]'); await p.waitForTimeout(600);
  const accounts = await p.$$eval('#a-list .rg-row', (rows) => rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
  console.log(accounts.join('\n'));
  const row = (email, text) => accounts.some((t) => t.includes(email) && t.includes(text));
  ok('Allo account: actives · Android', row('allo@exemple.fr', 'Alertes actives · Android'));
  ok('Khalid account: pas activées', row('khalid@exemple.fr', 'Alertes pas activées'));
  ok('ASG account: à vérifier', row('asg@exemple.fr', 'Alertes à vérifier'));
  ok('Micha (team): pas activées', row('micha@city-drop.com', 'Alertes pas activées'));
  await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(400);
  const provs = await p.$$eval('#s-provs .alert-chip', (cs) => cs.map((c) => c.textContent.trim())); console.log(provs);
  ok('providers: short chips, DHOLLIANDA without account', JSON.stringify(provs) === JSON.stringify(['Alertes', 'Sans alertes', 'À vérifier', 'Sans compte']));
  ok('Jérôme (lecture) has no chip', !accounts.find((t) => t.includes('jerome@')).includes('Alertes'));
  await p.click('[data-rg-open="alerts"]'); await p.waitForTimeout(600);
  const summary = await p.textContent('#al-who'); console.log(summary);
  ok('summary counts 1 provider of 3, 1 team of 2', /1 compte prestataire sur 3/.test(summary) && /1 de l'équipe sur 2/.test(summary));
  ok('summary: Khalid missing, ASG to check', /activées chez : Khalid Lavage\./.test(summary) && /À vérifier .*: ASG BDX LAVAGE/.test(summary));
  await p.waitForTimeout(400); await p.screenshot({ path: shots + '/alertes.png' });
  await p.click('.team-sheet .sheet-x'); await p.waitForTimeout(400);
  await p.locator('.rg-list', { has: p.locator('#s-provs') }).screenshot({ path: shots + '/prestataires-telephone.png' });
  ok('no page error', !p.errs.length); if (p.errs.length) console.log(p.errs);
  // Jérôme (read only) may not read the devices: no chip, no summary, no error.
  const j = await page(); await login(j, 'jerome@city-drop.com');
  await j.goto('http://localhost:8765/#reglages'); await j.waitForTimeout(1500);
  ok('lecture: no alert chips', (await j.$$('.alert-chip')).length === 0);
  ok('lecture: no page error', !j.errs.length); if (j.errs.length) console.log(j.errs);
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
