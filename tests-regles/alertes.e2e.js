// Parcours des alertes « appli fermée », dans les émulateurs Firebase (jamais le vrai projet) :
// Fabian branche le script et active ses alertes, Khalid active les siennes, le script (rejoué ici dans Node,
// tel qu'il tourne dans Google) annonce la demande à Khalid seul, Khalid fait le véhicule pendant que l'équipe
// a l'appli fermée, la demande passe « Réalisée » toute seule, et le script prévient l'équipe.
// Lancer depuis tests-regles/ : npm run alertes (Playwright doit être installé).
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const crypto = require('crypto'); const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FS = 'http://127.0.0.1:8080/v1/projects/suivi-prestations/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const val = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v } : typeof v === 'string' ? { stringValue: v }
  : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const put = (p, obj) => fetch(`${FS}/${p}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: val(obj).mapValue.fields }) }).then(r => { if (!r.ok) throw new Error(p + ' ' + r.status); });
const signUp = (email) => fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then(r => r.json());
const ok = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' ' + label); if (!cond) process.exitCode = 1; };

// ---------- the Apps Script, run in Node with Google's services imitated ----------
const pushes = []; const props = new Map(); const cache = new Map();
function curl(method, url, headers, body) {
  const args = ['-s', '-X', method.toUpperCase(), '-w', '\n%{http_code}'];
  Object.entries(headers || {}).forEach(([k, v]) => args.push('-H', `${k}: ${v}`));
  if (body !== undefined) args.push('--data-binary', body);
  const out = execFileSync('curl', [...args, url], { encoding: 'utf8' });
  const i = out.lastIndexOf('\n');
  return { code: +out.slice(i + 1), text: out.slice(0, i) };
}
const signedBytes = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));
const sandbox = {
  console, BigInt, JSON, Date, Math, Object, Array, String, Number, encodeURIComponent, unescape,
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, MacAlgorithm: { HMAC_SHA_256: 'sha256' },
    computeDigest: (alg, bytes) => signedBytes(crypto.createHash(alg).update(Buffer.from(bytes.map((b) => b & 255))).digest()),
    computeHmacSignature: (alg, value, key) => signedBytes(crypto.createHmac(alg, Buffer.from(key.map((b) => b & 255))).update(Buffer.from(value.map((b) => b & 255))).digest()),
    getUuid: () => crypto.randomUUID(),
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k) }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => {}, newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => t }) },
  UrlFetchApp: {
    fetch(url, o = {}) {
      let r;
      if (/push\.apple\.com|fcm\.googleapis\.com/.test(url)) { pushes.push({ url, auth: o.headers.Authorization }); r = { code: 201, text: '' }; }
      else {
        const local = url.replace('https://identitytoolkit.googleapis.com/v1', AUTH).replace('https://firestore.googleapis.com/v1/projects/suivi-prestations/databases/(default)/documents', FS);
        r = curl(o.method || 'get', local, { ...(o.headers || {}), ...(o.contentType ? { 'Content-Type': o.contentType } : {}) }, o.payload);
      }
      return { getResponseCode: () => r.code, getContentText: () => r.text };
    },
  },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script/notifications.js'), 'utf8'), sandbox);
const script = (code) => vm.runInContext(code, sandbox);

(async () => {
  const debut = new Date(Date.now() - 60000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  await put('comptes/fabian@city-drop.com', { role: 'admin', email: 'fabian@city-drop.com' });
  await put('comptes/khalid@lavage.fr', { role: 'prestataire', prestataireId: 'khalid', email: 'khalid@lavage.fr' });
  await put('comptes/robot@city-drop.com', { role: 'robot', email: 'robot@city-drop.com' });
  await put('config/reglages', { prestataires: ['Khalid', 'ALLO pare-brise 78'], sites: [{ nom: 'Saint-Cloud', adresse: '1 quai' }] });
  await put('prestataires/khalid', { nom: 'Khalid', tarifs: [] });
  await put('demandes/ancienne', { prestataire: 'Khalid', prestataireId: 'khalid', plaque: 'ZZ-999-ZZ', service: 'lavage', site: 'Saint-Cloud', date: today, statut: 'envoyee', createdAt: '2026-11-01T08:00:00.000Z', updatedAt: new Date().toISOString() });
  for (const e of ['fabian@city-drop.com', 'khalid@lavage.fr', 'robot@city-drop.com']) await signUp(e);

  props.set('ROBOT_EMAIL', 'robot@city-drop.com'); props.set('ROBOT_MOT_DE_PASSE', 'secret123');
  script('installerNotifications()');
  props.set('NOTIF_DEPUIS', debut);
  const cle = props.get('NOTIF_CLE_PUBLIQUE');
  ok('le script crée ses clés et se connecte avec le robot', /^[\w-]{87}$/.test(cle));

  const SCRIPT = 'https://script.google.com/macros/s/TEST-alertes/exec';
  const hits = [];
  const srv = http.createServer((q, r) => { const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.existsSync(f) ? (r.setHeader('Content-Type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream'), r.end(fs.readFileSync(f))) : (r.statusCode = 404, r.end()); }).listen(8765);
  const b = await chromium.launch();
  const SHOTS = process.env.CAPTURES; // optional folder for screenshots of the new screens
  const page = async (phone) => {
    const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { deviceScaleFactor: 2 }); await ctx.grantPermissions(['notifications'], { origin: 'http://localhost:8765' });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.errs = errs;
    await p.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ contentType: 'text/javascript',
      body: fs.readFileSync(path.join(process.env.FB_DIR || path.join(__dirname, 'node_modules/firebase'), r.request().url().split('/').pop())) }));
    await p.route(SCRIPT + '*', (r) => { const u = new URL(r.request().url()); hits.push(u.searchParams.get('action')); r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(u.searchParams.get('action') === 'cle' ? { cle } : {}) }); });
    await p.addInitScript(() => {
      let fb; Object.defineProperty(window, 'firebase', { configurable: true, get: () => fb, set: (v) => {
        fb = v; const init = v.initializeApp.bind(v);
        v.initializeApp = (c) => { const app = init(c); v.firestore().useEmulator('127.0.0.1', 8080); v.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); return app; };
      } });
      // The person has not answered the browser question yet: « Autoriser » is pressed when asked.
      let perm = 'default';
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => perm });
      Notification.requestPermission = async () => (perm = 'granted');
      // Headless Chromium has no push service: a fake Apple-like subscription, with the real key check.
      PushManager.prototype.getSubscription = async function () { return this.__sub || null; };
      PushManager.prototype.subscribe = async function (o) { this.__sub = { endpoint: 'https://web.push.apple.com/fake-' + Math.random().toString(36).slice(2), options: { applicationServerKey: o.applicationServerKey.buffer || o.applicationServerKey }, unsubscribe: async () => true }; return this.__sub; };
    });
    await p.goto('http://localhost:8765/'); await p.waitForSelector('#login input');
    return p;
  };
  const login = async (p, email) => { await p.fill('#login input[type=email]', email); await p.fill('#login input[type=password]', 'secret123'); await p.click('#login button'); await p.waitForTimeout(1800); };
  const abonnements = () => fetch(`${FS}/abonnements`, { headers: owner }).then(r => r.json()).then(j => (j.documents || []).map(d => script("docVersObjet")(d)));
  const demande = (id) => fetch(`${FS}/demandes/${id}`, { headers: owner }).then(r => r.json()).then(script("docVersObjet"));

  // 1. Fabian plugs the script in and turns his alerts on
  const f = await page(); await login(f, 'fabian@city-drop.com');
  await f.goto('http://localhost:8765/#reglages'); await f.waitForTimeout(500);
  await f.fill('#al-url', SCRIPT); await f.click('#al-save'); await f.waitForTimeout(1200);
  if (SHOTS) await f.locator('.panel', { has: f.locator('#al-url') }).screenshot({ path: path.join(SHOTS, 'reglages-alertes.png') });
  ok('Réglages : adresse du script enregistrée', (await f.textContent('#al-status')).includes('pas encore activées'));
  await f.goto('http://localhost:8765/#retours'); await f.waitForTimeout(300);
  ok('Retours : bouton « Activer les alertes » visible', await f.isVisible('#notifBtn'));
  if (SHOTS) await f.screenshot({ path: path.join(SHOTS, 'retours-bouton-alertes.png'), clip: { x: 0, y: 0, width: 1280, height: 330 } });
  await f.click('#notifBtn'); await f.waitForTimeout(1500);
  let abos = await abonnements();
  ok('l\'ordinateur de Fabian est inscrit comme équipe', abos.some(a => a.email === 'fabian@city-drop.com' && a.role === 'admin' && /^[a-f0-9]{32}$/.test(a.jeton)));
  ok('une alerte d\'essai est demandée', hits.includes('test'));
  ok('bouton masqué une fois actif', !(await f.isVisible('#notifBtn')));
  ok('pas d\'erreur chez Fabian', f.errs.length === 0 || console.log(f.errs));

  // 2. Khalid sees the card and turns his alerts on
  await put('demandes/n0', { prestataire: 'Khalid', prestataireId: 'khalid', plaque: 'FX-210-KL', service: 'lavage', site: 'Saint-Cloud', date: today, statut: 'confirmee', createdAt: debut, updatedAt: debut, notifie: { demande: 'khalid', annulee: false } });
  const k = await page(true); await login(k, 'khalid@lavage.fr');
  if (SHOTS) await k.screenshot({ path: path.join(SHOTS, 'prestataire-encadre-alertes.png') });
  ok('Khalid voit l\'encadré des alertes', await k.isVisible('.alert-card [data-alerts]'));
  await k.click('.alert-card [data-alerts]'); await k.waitForTimeout(1500);
  abos = await abonnements();
  ok('le téléphone de Khalid est inscrit pour Khalid', abos.some(a => a.email === 'khalid@lavage.fr' && a.role === 'prestataire' && a.prestataireId === 'khalid'));
  ok('l\'encadré disparaît', !(await k.isVisible('.alert-card')));
  const sw = await k.evaluate(() => navigator.serviceWorker.getRegistration().then(r => !!r && r.active?.scriptURL));
  ok('sw.js est installé', String(sw).endsWith('/sw.js'));

  // 3. Fabian saves a new request for Khalid; the script announces it to Khalid only
  await put('demandes/n1', { prestataire: 'Khalid', prestataireId: 'khalid', plaque: 'GS-487-PR', service: 'lavage', site: 'Saint-Cloud', date: today, debut: '08:30', fin: '19:30', statut: 'envoyee', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await f.close();
  script('verifierNotifications()');
  const khalidAbo = abos.find(a => a.email === 'khalid@lavage.fr'); const fabianAbo = abos.find(a => a.email === 'fabian@city-drop.com');
  ok('une alerte part vers le téléphone de Khalid', pushes.length === 1 && pushes[0].url === khalidAbo.endpoint && /^vapid t=.+, k=/.test(pushes[0].auth));
  const msg = JSON.parse(cache.get('msg_' + khalidAbo.jeton) || '{}');
  ok('texte : « Nouvelle demande GS-487-PR »', msg.titre === 'Nouvelle demande' && msg.texte.startsWith('GS-487-PR · Lavage · Saint-Cloud'));
  ok('l\'ancienne demande (avant installation) n\'est pas annoncée', !msg.texte.includes('ZZ-999-ZZ'));
  ok('marque « déjà annoncé » posée', (await demande('n1')).notifie?.demande === 'khalid');
  script('verifierNotifications()');
  ok('pas de deuxième alerte au passage suivant', pushes.length === 1);
  const lu = JSON.parse(script(`doGet({ parameter: { action: 'notif', jeton: '${khalidAbo.jeton}' } })`));
  ok('le téléphone récupère son texte avec son jeton, une fois', lu.titre === 'Nouvelle demande' && JSON.parse(script(`doGet({ parameter: { action: 'notif', jeton: '${khalidAbo.jeton}' } })`)).titre === undefined);

  // 4. Khalid accepts then does it while nobody of the team has the app open
  await k.waitForTimeout(500);
  await k.click('[data-take="n1"]'); await k.waitForTimeout(1200);
  ok('acceptation : la demande passe « Confirmée » toute seule', (await demande('n1')).statut === 'confirmee');
  await k.click('[data-tab="today"]'); await k.waitForTimeout(300);
  await k.click('[data-form="done:n1"]'); await k.click('[data-send="done:n1"]'); await k.waitForTimeout(1500);
  const d = await demande('n1');
  ok('« Prestation réalisée » : « Réalisée » sans l\'équipe', d.statut === 'realisee' && d.doneAt === d.retour.at);
  ok('l\'appli a demandé au script de regarder tout de suite', hits.filter(h => h === 'verifier').length >= 1);
  script('verifierNotifications()');
  ok('l\'équipe est prévenue', pushes.length >= 2 && pushes.some(p => p.url === fabianAbo.endpoint));
  const equipe = JSON.parse(cache.get('msg_' + fabianAbo.jeton) || '{}');
  ok('texte : « Khalid a fait GS-487-PR »', /Khalid a fait GS-487-PR/.test(equipe.texte) && equipe.url === './#retours');
  ok('Khalid ne reçoit pas les retours', pushes.filter(p => p.url === khalidAbo.endpoint).length === 1);
  ok('pas d\'erreur chez Khalid', k.errs.length === 0 || console.log(k.errs));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
