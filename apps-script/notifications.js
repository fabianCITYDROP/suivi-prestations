// Alertes « appli fermée » de Suivi prestations (Web Push, gratuit, sans forfait Firebase payant).
//
// À coller dans le MÊME projet Apps Script que import-mails.js (même compte robot), dans un 2e fichier
// (mode d'emploi : apps-script/LISEZMOI.md). Toutes les 5 minutes, et tout de suite quand l'appli le
// demande après un enregistrement, le script regarde les demandes modifiées depuis peu :
//   - une nouvelle demande pour un prestataire  -> alerte sur les téléphones de ce prestataire ;
//   - une demande annulée qu'il avait reçue      -> alerte « Demande annulée » chez lui ;
//   - une réponse d'un prestataire (fait, accepté, autre date…) -> alerte chez l'équipe (comptes admin) ;
//   - un problème signalé sur un véhicule (choc, pneu, voyant…)  -> alerte chez l'équipe aussi.
// Chaque matin vers 8 h (Paris), une alerte à l'équipe liste les prestations pas faites et les demandes sans réponse.
// Il note sur la demande ce qui a été annoncé (champ « notifie ») : une alerte ne part jamais deux fois.
//
// L'alerte envoyée au téléphone est vide (rien de lisible ne passe par Apple ou Google) : le téléphone
// redemande ensuite le texte à ce script avec son jeton secret, connu de lui seul.
// La clé privée qui signe les alertes est créée par « installerNotifications » et reste dans
// Paramètres du projet › Propriétés du script (NOTIF_CLE_PRIVEE) : elle n'est jamais écrite ici.

const NOTIF_CLE_WEB = 'AIzaSyBIFL2pF1QwaYpyLo2lc8aOwjd1G86Eg8w'; // clé publique de la page web, pas un secret
const NOTIF_FIRESTORE = 'https://firestore.googleapis.com/v1/projects/suivi-prestations/databases/(default)/documents';
const NOTIF_SITE = 'https://fabiancitydrop.github.io/suivi-prestations/';
// Seuls les vrais services d'alertes des téléphones et navigateurs sont appelés.
const NOTIF_SERVICES = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

// ---------- courbe P-256 et signature ES256 (fonctions pures, testées dans notifications.test.js) ----------
const NB = (x) => BigInt(x);
const EC = {
  p: NB('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
  n: NB('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
  a: NB('0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc'),
  g: { x: NB('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'), y: NB('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5') },
};
const ecMod = (a, m) => { const r = a % m; return r < NB(0) ? r + m : r; };
function ecInv(a, m) {
  let [r0, r1, s0, s1] = [ecMod(a, m), m, NB(1), NB(0)];
  while (r1 !== NB(0)) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  return ecMod(s0, m);
}
function ecAdd(P, Q) {
  if (!P) return Q;
  if (!Q) return P;
  const p = EC.p;
  let l;
  if (P.x === Q.x) {
    if (ecMod(P.y + Q.y, p) === NB(0)) return null;
    l = ecMod((NB(3) * P.x * P.x + EC.a) * ecInv(NB(2) * P.y, p), p);
  } else l = ecMod((Q.y - P.y) * ecInv(Q.x - P.x, p), p);
  const x = ecMod(l * l - P.x - Q.x, p);
  return { x, y: ecMod(l * (P.x - x) - P.y, p) };
}
function ecMul(k, P) {
  let R = null, A = P;
  while (k > NB(0)) { if (k & NB(1)) R = ecAdd(R, A); A = ecAdd(A, A); k >>= NB(1); }
  return R;
}
const octetsVersNombre = (b) => b.reduce((acc, x) => (acc << NB(8)) + NB(x & 255), NB(0));
function nombreVersOctets(x, taille) {
  const out = new Array(taille).fill(0);
  for (let i = taille - 1; i >= 0; i--) { out[i] = Number(x & NB(255)); x >>= NB(8); }
  return out;
}
const texteVersOctets = (s) => Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0));
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function base64url(octets) {
  let out = '';
  for (let i = 0; i < octets.length; i += 3) {
    const [a, b, c] = [octets[i] & 255, octets[i + 1] & 255, octets[i + 2] & 255];
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < octets.length ? B64[(n >> 6) & 63] : '') + (i + 2 < octets.length ? B64[n & 63] : '');
  }
  return out;
}

// Clés de signature des alertes (VAPID) : 32 octets au hasard -> clé privée ; la publique va dans l'appli.
function creerCles(aleatoire32) {
  const d = ecMod(octetsVersNombre(aleatoire32), EC.n - NB(1)) + NB(1);
  const Q = ecMul(d, EC.g);
  return { privee: base64url(nombreVersOctets(d, 32)), publique: base64url([4, ...nombreVersOctets(Q.x, 32), ...nombreVersOctets(Q.y, 32)]) };
}
function depuisBase64url(s) {
  const out = [];
  let bits = 0, n = 0;
  for (const c of s.replace(/=+$/, '')) { n = (n << 6) | B64.indexOf(c); bits += 6; if (bits >= 8) { bits -= 8; out.push((n >> bits) & 255); } }
  return out;
}

// Signature ECDSA P-256 / SHA-256 à nonce déterministe (RFC 6979). outils = { sha256(octets), hmac(cle, octets) }.
function signerES256(message, priveeB64, outils) {
  const d = octetsVersNombre(depuisBase64url(priveeB64));
  const h = outils.sha256(message);
  const z = octetsVersNombre(h);
  const x = nombreVersOctets(d, 32), h1 = nombreVersOctets(ecMod(z, EC.n), 32);
  let V = new Array(32).fill(1), K = new Array(32).fill(0);
  K = outils.hmac(K, [...V, 0, ...x, ...h1]); V = outils.hmac(K, V);
  K = outils.hmac(K, [...V, 1, ...x, ...h1]); V = outils.hmac(K, V);
  for (;;) {
    V = outils.hmac(K, V);
    const k = octetsVersNombre(V);
    if (k > NB(0) && k < EC.n) {
      const r = ecMod(ecMul(k, EC.g).x, EC.n);
      const s = ecMod(ecInv(k, EC.n) * (z + r * d), EC.n);
      if (r !== NB(0) && s !== NB(0)) return [...nombreVersOctets(r, 32), ...nombreVersOctets(s, 32)];
    }
    K = outils.hmac(K, [...V, 0]); V = outils.hmac(K, V);
  }
}
// Le « laissez-passer » signé que réclament Apple, Google, Mozilla et Microsoft pour livrer une alerte.
function jetonVapid(adresseService, cles, maintenantSec, outils) {
  const aud = (String(adresseService).match(/^https:\/\/[^/]+/) || [''])[0];
  const enTete = base64url(texteVersOctets(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corps = base64url(texteVersOctets(JSON.stringify({ aud, exp: maintenantSec + 12 * 3600, sub: NOTIF_SITE })));
  const signature = base64url(signerES256(texteVersOctets(enTete + '.' + corps), cles.privee, outils));
  return 'vapid t=' + enTete + '.' + corps + '.' + signature + ', k=' + cles.publique;
}
function serviceAutorise(adresse) {
  const m = String(adresse || '').match(/^https:\/\/([^/:]+)\//);
  return !!m && NOTIF_SERVICES.some((re) => re.test(m[1].toLowerCase()));
}

// ---------- ce qu'il faut annoncer (fonctions pures, testées) ----------
const SERVICES_NOTIF = { 'pare-brise': 'Pare-brise', lavage: 'Lavage', intervention: 'Intervention' };
const REPONSES_NOTIF = { confirme: 'a accepté', fait: 'a fait', absent: "n'a pas trouvé", 'autre-date': 'propose une autre date pour', refuse: 'ne peut pas faire', erreur: 'a annulé son « fait » (erreur de véhicule) sur' };
const jourCourt = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '');
const ligneDemande = (d) => [d.plaque, SERVICES_NOTIF[d.service] || d.service, d.site, jourCourt(d.date)].filter(Boolean).join(' · ');

// demandes : modifiées depuis peu ; depuis : date d'installation (rien d'antérieur n'est annoncé).
// Renvoie { prestataires: { id: { nouvelles: [], annulees: [] } }, equipe: [lignes], marques: [{ id, notifie }] }.
function aAnnoncer(demandes, depuis) {
  const prestataires = {}, equipe = [], marques = [];
  const pour = (id) => (prestataires[id] = prestataires[id] || { nouvelles: [], annulees: [] });
  demandes.forEach((d) => {
    const avant = d.notifie || {};
    const apres = { ...avant };
    if (d.prestataireId && d.statut !== 'annulee' && (avant.demande !== d.prestataireId || avant.annulee) && (d.createdAt || '') >= depuis) {
      pour(d.prestataireId).nouvelles.push(ligneDemande(d));
      apres.demande = d.prestataireId; apres.annulee = false;
    }
    if (d.statut === 'annulee' && avant.demande && !avant.annulee) {
      pour(avant.demande).annulees.push(ligneDemande(d));
      apres.annulee = true;
    }
    const r = d.retour;
    if (r && r.at && r.etat && r.at >= depuis && avant.retour !== r.at) {
      equipe.push((d.prestataire || 'Un prestataire') + ' ' + (REPONSES_NOTIF[r.etat] || 'a répondu pour') + ' ' + d.plaque + (r.date ? ' : le ' + jourCourt(r.date) + (r.debut ? ' à ' + r.debut : '') : '') + (r.note ? ' : ' + r.note : ''));
      apres.retour = r.at;
    }
    if (JSON.stringify(apres) !== JSON.stringify(avant)) marques.push({ id: d.id, notifie: apres });
  });
  return { prestataires, equipe, marques };
}
// Problèmes signalés sur un véhicule (collection « signalements », jamais modifiée par ce script).
// dejaVus : { id du signalement: date } déjà annoncés ; nomDe(signalement) : nom du prestataire.
// Renvoie { lignes: [textes pour l'équipe], vus: { id: date } à retenir (les anciens sont oubliés au bout d'une heure) }.
const PROBLEMES_NOTIF = { choc: 'Choc / carrosserie', pneu: 'Pneu', voyant: 'Voyant allumé', autre: 'Autre' };
function problemesAAnnoncer(signalements, dejaVus, depuis, maintenantIso, nomDe) {
  const lignes = [];
  const limite = new Date(new Date(maintenantIso).getTime() - 3600 * 1000).toISOString();
  const vus = Object.fromEntries(Object.entries(dejaVus || {}).filter(([, at]) => at > limite));
  signalements.forEach((s) => {
    if (!s.at || s.at < depuis || s.statut === 'traite' || vus[s.id] || (dejaVus || {})[s.id]) return;
    // Les nouveaux signalements n'ont que du texte (type « autre ») ; les anciens gardent leur type devant.
    const quoi = (!s.type || s.type === 'autre') && s.texte ? s.texte : [PROBLEMES_NOTIF[s.type] || 'Problème', s.texte].filter(Boolean).join(' – ');
    lignes.push((nomDe(s) || 'Un prestataire') + ' signale un problème sur ' + s.plaque + ' : ' + quoi);
    vus[s.id] = s.at;
  });
  return { lignes, vus };
}
const pluriel = (n, un, plusieurs) => (n > 1 ? n + ' ' + plusieurs : un);
function messagePrestataire({ nouvelles, annulees }) {
  const titres = [];
  if (nouvelles.length) titres.push(pluriel(nouvelles.length, 'Nouvelle demande', 'nouvelles demandes'));
  if (annulees.length) titres.push(pluriel(annulees.length, 'Demande annulée', 'demandes annulées'));
  const lignes = [...nouvelles, ...annulees.map((l) => 'Annulée : ' + l)];
  return { titre: titres.join(' · '), texte: lignes.slice(0, 5).join('\n') + (lignes.length > 5 ? '\n…' : ''), url: './' };
}
// Les problèmes passent en premier : c'est ce qu'il faut voir d'abord.
function messageEquipe(retours, problemes) {
  const pb = problemes || [];
  const titres = [];
  if (pb.length) titres.push(pluriel(pb.length, 'Problème signalé sur un véhicule', 'problèmes signalés sur des véhicules'));
  if (retours.length) titres.push(pluriel(retours.length, 'Retour d\'un prestataire', 'retours des prestataires'));
  const lignes = [...pb, ...retours];
  return { titre: titres.join(' · '), texte: lignes.slice(0, 5).join('\n') + (lignes.length > 5 ? '\n…' : ''), url: './#retours' };
}

// Rappel du matin : ce qui a été oublié. aujourdhuiIso : date de Paris 'AAAA-MM-JJ' ; maintenantIso : instant actuel.
// Renvoie { pasFaites: [lignes], sansReponse: [lignes] } (les plus anciennes en premier).
// Les demandes « hayon » sont ignorées (clôturées automatiquement ailleurs), comme celles déjà faites, réalisées ou annulées.
function oublisDuMatin(demandes, aujourdhuiIso, maintenantIso) {
  const limite = new Date(maintenantIso).getTime() - 24 * 3600 * 1000;
  const ligne = (d) => ligneDemande(d) + (d.prestataire ? ' (' + d.prestataire + ')' : '');
  const pasFaites = [], sansReponse = [];
  demandes.forEach((d) => {
    if (d.statut === 'realisee' || d.statut === 'annulee' || d.service === 'hayon' || (d.retour && d.retour.etat === 'fait')) return;
    const dernierJour = d.dateFin || d.date;
    if (d.date && dernierJour < aujourdhuiIso) { pasFaites.push({ cle: dernierJour, texte: ligne(d) }); return; }
    const depuis = d.sentAt || d.createdAt;
    if (['a_envoyer', 'envoyee'].includes(d.statut) && d.prestataireId && !d.retour && depuis && new Date(depuis).getTime() <= limite) {
      sansReponse.push({ cle: depuis, texte: ligne(d) });
    }
  });
  const trier = (l) => l.sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0)).map((x) => x.texte);
  return { pasFaites: trier(pasFaites), sansReponse: trier(sansReponse) };
}
function messageRappel({ pasFaites, sansReponse }) {
  if (!pasFaites.length && !sansReponse.length) return null;
  const titres = [];
  if (pasFaites.length) titres.push(pluriel(pasFaites.length, '1 prestation pas faite', 'prestations pas faites'));
  if (sansReponse.length) titres.push(pluriel(sansReponse.length, '1 demande sans réponse depuis 24 h', 'demandes sans réponse depuis 24 h'));
  const lignes = [...pasFaites.map((l) => 'Pas faite : ' + l), ...sansReponse.map((l) => 'Sans réponse : ' + l)];
  return { titre: 'Rappel du matin : ' + titres.join(' · '), texte: lignes.slice(0, 6).join('\n') + (lignes.length > 6 ? '\n…' : ''), url: './' };
}

// ---------- Firestore (format REST) ----------
function depuisFirestore(v) {
  if (!v || 'nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return champsVersObjet(v.mapValue.fields);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(depuisFirestore);
  return null;
}
const champsVersObjet = (champs) => Object.fromEntries(Object.entries(champs || {}).map(([k, v]) => [k, depuisFirestore(v)]));
const docVersObjet = (doc) => ({ id: doc.name.split('/').pop(), ...champsVersObjet(doc.fields) });
function marqueVersFirestore(n) {
  const champs = {};
  if (n.demande) champs.demande = { stringValue: n.demande };
  if (n.annulee !== undefined) champs.annulee = { booleanValue: !!n.annulee };
  if (n.retour) champs.retour = { stringValue: n.retour };
  return { fields: { notifie: { mapValue: { fields: champs } } } };
}

// ---------- ce qui tourne dans Apps Script ----------
const NOTIF_OUTILS = {
  sha256: (octets) => Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, octets).map((b) => b & 255),
  hmac: (cle, octets) => Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, octets.map((b) => (b > 127 ? b - 256 : b)), cle.map((b) => (b > 127 ? b - 256 : b))).map((b) => b & 255),
};
function notifFirestore(methode, chemin, corps) {
  const options = { method: methode, contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + notifRobot() } };
  if (corps) options.payload = JSON.stringify(corps);
  return UrlFetchApp.fetch(NOTIF_FIRESTORE + chemin, options);
}
// Le robot (même compte que l'import des mails) se connecte une fois par heure environ.
function notifRobot() {
  const cache = CacheService.getScriptCache();
  const deja = cache.get('notif_robot');
  if (deja) return deja;
  const props = PropertiesService.getScriptProperties();
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + NOTIF_CLE_WEB, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ email: props.getProperty('ROBOT_EMAIL'), password: props.getProperty('ROBOT_MOT_DE_PASSE'), returnSecureToken: true }),
  });
  if (r.getResponseCode() !== 200) throw new Error('Connexion du robot refusée : vérifie ROBOT_EMAIL et ROBOT_MOT_DE_PASSE.');
  const jeton = JSON.parse(r.getContentText()).idToken;
  cache.put('notif_robot', jeton, 50 * 60);
  return jeton;
}
function notifCles() {
  const props = PropertiesService.getScriptProperties();
  const privee = props.getProperty('NOTIF_CLE_PRIVEE'), publique = props.getProperty('NOTIF_CLE_PUBLIQUE');
  if (!privee || !publique) throw new Error('Clés absentes : lance d\'abord installerNotifications.');
  return { privee, publique };
}

// Demandes modifiées dans les 15 dernières minutes (marge pour un téléphone un peu en retard sur l'heure).
function demandesRecentes() {
  const seuil = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const r = notifFirestore('post', ':runQuery', { structuredQuery: {
    from: [{ collectionId: 'demandes' }],
    where: { fieldFilter: { field: { fieldPath: 'updatedAt' }, op: 'GREATER_THAN', value: { stringValue: seuil } } },
    limit: 300,
  } });
  if (r.getResponseCode() !== 200) throw new Error('Lecture des demandes refusée (' + r.getResponseCode() + ') : ' + r.getContentText().slice(0, 300));
  return JSON.parse(r.getContentText()).filter((x) => x.document).map((x) => docVersObjet(x.document));
}
// Demandes encore ouvertes (pas réalisées, pas annulées), pour le rappel du matin.
function demandesOuvertes() {
  const r = notifFirestore('post', ':runQuery', { structuredQuery: {
    from: [{ collectionId: 'demandes' }],
    where: { fieldFilter: { field: { fieldPath: 'statut' }, op: 'IN', value: { arrayValue: { values: ['a_envoyer', 'envoyee', 'confirmee'].map((v) => ({ stringValue: v })) } } } },
    limit: 500,
  } });
  if (r.getResponseCode() !== 200) throw new Error('Lecture des demandes ouvertes refusée (' + r.getResponseCode() + ') : ' + r.getContentText().slice(0, 300));
  return JSON.parse(r.getContentText()).filter((x) => x.document).map((x) => docVersObjet(x.document));
}
// Problèmes signalés dans les 15 dernières minutes. Avant la publication des règles qui l'autorisent,
// la lecture est refusée : on continue sans, les autres alertes ne sont pas gênées.
function signalementsRecents() {
  const seuil = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const r = notifFirestore('post', ':runQuery', { structuredQuery: {
    from: [{ collectionId: 'signalements' }],
    where: { fieldFilter: { field: { fieldPath: 'at' }, op: 'GREATER_THAN', value: { stringValue: seuil } } },
    limit: 100,
  } });
  if (r.getResponseCode() !== 200) { console.warn('Lecture des problèmes signalés refusée (' + r.getResponseCode() + ') : les règles Firestore sont-elles à jour ?'); return []; }
  return JSON.parse(r.getContentText()).filter((x) => x.document).map((x) => docVersObjet(x.document));
}
function nomPrestataire(signalement, demandes) {
  // « Signaler » (vu en passant) : rattaché à aucune demande ; le nom vient d'une autre demande du même prestataire.
  if (!signalement.demandeId) return (demandes.find((x) => x.prestataireId === signalement.prestataireId && x.prestataire) || {}).prestataire || '';
  const d = demandes.find((x) => x.id === signalement.demandeId);
  if (d) return d.prestataire || '';
  const r = notifFirestore('get', '/demandes/' + encodeURIComponent(signalement.demandeId));
  return r.getResponseCode() === 200 ? (docVersObjet(JSON.parse(r.getContentText())).prestataire || '') : '';
}
function abonnements() {
  const r = notifFirestore('get', '/abonnements?pageSize=300');
  if (r.getResponseCode() !== 200) throw new Error('Lecture des abonnements refusée (' + r.getResponseCode() + ')');
  return (JSON.parse(r.getContentText()).documents || []).map(docVersObjet);
}

// Un laissez-passer signé vaut 12 h : on le garde 6 h par service (Apple, Google…) au lieu de signer à chaque alerte.
function laissezPasser(adresse) {
  const cache = CacheService.getScriptCache();
  const cle = 'vapid_' + (adresse.match(/^https:\/\/([^/]+)/) || ['', ''])[1];
  const deja = cache.get(cle);
  if (deja) return deja;
  const jeton = jetonVapid(adresse, notifCles(), Math.floor(Date.now() / 1000), NOTIF_OUTILS);
  cache.put(cle, jeton, 6 * 3600);
  return jeton;
}
// Range le texte pour le téléphone (il viendra le chercher), puis envoie l'alerte vide.
function envoyer(abonnement, message) {
  if (!serviceAutorise(abonnement.endpoint) || !abonnement.jeton) return;
  const cache = CacheService.getScriptCache();
  const cle = 'msg_' + abonnement.jeton;
  const deja = JSON.parse(cache.get(cle) || 'null');
  const final = deja ? { ...message, titre: message.titre, texte: (message.texte + '\n' + deja.texte).split('\n').slice(0, 6).join('\n') } : message;
  cache.put(cle, JSON.stringify(final), 6 * 3600);
  const r = UrlFetchApp.fetch(abonnement.endpoint, {
    method: 'post', muteHttpExceptions: true, payload: '',
    headers: { TTL: '86400', Urgency: 'high', Authorization: laissezPasser(abonnement.endpoint) },
  });
  const code = r.getResponseCode();
  if (code === 404 || code === 410) { notifFirestore('delete', '/abonnements/' + abonnement.id); console.log('Appareil désinscrit retiré : ' + abonnement.email); }
  else if (code >= 300) console.warn('Alerte refusée (' + code + ') pour ' + abonnement.email + ' : ' + r.getContentText().slice(0, 200));
}

function verifierNotifications() {
  const verrou = LockService.getScriptLock();
  const props = PropertiesService.getScriptProperties();
  if (!verrou.tryLock(2000)) { props.setProperty('NOTIF_ENCORE', '1'); return; } // déjà en cours : il repassera
  try {
    for (let tour = 0; tour < 3; tour++) {
      props.deleteProperty('NOTIF_ENCORE');
      verifierUneFois(props.getProperty('NOTIF_DEPUIS') || new Date().toISOString());
      if (!props.getProperty('NOTIF_ENCORE')) break;
    }
  } finally { verrou.releaseLock(); }
}
function verifierUneFois(depuis) {
  const demandes = demandesRecentes();
  const { prestataires, equipe, marques } = aAnnoncer(demandes, depuis);
  const props = PropertiesService.getScriptProperties();
  const dejaVus = JSON.parse(props.getProperty('NOTIF_PROBLEMES_VUS') || '{}');
  const problemes = problemesAAnnoncer(signalementsRecents(), dejaVus, depuis, new Date().toISOString(), (s) => nomPrestataire(s, demandes));
  if (!marques.length && !problemes.lignes.length) return;
  const appareils = abonnements();
  Object.entries(prestataires).forEach(([id, quoi]) => {
    const msg = messagePrestataire(quoi);
    appareils.filter((a) => a.role === 'prestataire' && a.prestataireId === id).forEach((a) => envoyer(a, msg));
    console.log(msg.titre + ' -> ' + id);
  });
  if (equipe.length || problemes.lignes.length) {
    const msg = messageEquipe(equipe, problemes.lignes);
    appareils.filter((a) => a.role === 'admin').forEach((a) => envoyer(a, msg));
    console.log(msg.titre + ' -> équipe');
  }
  if (problemes.lignes.length) props.setProperty('NOTIF_PROBLEMES_VUS', JSON.stringify(problemes.vus));
  marques.forEach((m) => {
    const r = notifFirestore('patch', '/demandes/' + encodeURIComponent(m.id) + '?currentDocument.exists=true&updateMask.fieldPaths=notifie', marqueVersFirestore(m.notifie));
    if (r.getResponseCode() !== 200) console.warn('Marque non posée (' + r.getResponseCode() + ') sur ' + m.id);
  });
}

// Adresse Web du script (Déployer › Application Web). Elle ne fait que trois choses sans danger :
//   ?action=cle              -> la clé PUBLIQUE des alertes (l'appli s'en sert pour inscrire un téléphone)
//   ?action=verifier         -> « regarde maintenant » (un seul passage à la fois ; ne lit rien de ce qu'on lui envoie)
//   ?action=notif&jeton=…    -> le texte de la dernière alerte de CE téléphone (jeton secret de 32 caractères)
//   ?action=test&jeton=…     -> une alerte d'essai sur ce téléphone, juste après l'activation
function doGet(e) {
  const p = (e && e.parameter) || {};
  const json = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  const jetonValide = /^[a-f0-9]{32}$/.test(p.jeton || '');
  try {
    if (p.action === 'cle') return json({ cle: notifCles().publique });
    if (p.action === 'verifier') { verifierNotifications(); return json({ ok: true }); }
    if (p.action === 'notif' && jetonValide) {
      const cache = CacheService.getScriptCache();
      const msg = cache.get('msg_' + p.jeton);
      cache.remove('msg_' + p.jeton);
      return json(msg ? JSON.parse(msg) : {});
    }
    if (p.action === 'test' && jetonValide) {
      const cache = CacheService.getScriptCache();
      if (cache.get('test_' + p.jeton)) return json({ ok: false, plusTard: true });
      cache.put('test_' + p.jeton, '1', 60);
      const a = abonnements().find((x) => x.jeton === p.jeton);
      if (!a) return json({ ok: false });
      envoyer(a, { titre: 'Alertes activées', texte: 'Tu seras prévenu ici, même appli fermée.', url: a.role === 'admin' ? './#retours' : './' });
      return json({ ok: true });
    }
  } catch (err) { console.error(err); return json({ erreur: true }); }
  return json({});
}

// À lancer une seule fois (bouton ▶) : crée les clés si besoin et le passage toutes les 5 minutes.
// Rien de ce qui existait avant l'installation n'est annoncé.
function installerNotifications() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('NOTIF_CLE_PRIVEE')) {
    const hasard = NOTIF_OUTILS.sha256(texteVersOctets([Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid(), Date.now(), Math.random()].join('|')));
    const cles = creerCles(hasard);
    props.setProperty('NOTIF_CLE_PRIVEE', cles.privee);
    props.setProperty('NOTIF_CLE_PUBLIQUE', cles.publique);
  }
  if (!props.getProperty('NOTIF_DEPUIS')) props.setProperty('NOTIF_DEPUIS', new Date().toISOString());
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'verifierNotifications').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('verifierNotifications').timeBased().everyMinutes(5).create();
  notifRobot();
  abonnements();
  installerRappelDuMatin();
  console.log('Prêt. Étape suivante : Déployer › Nouveau déploiement › Application Web (exécuter en tant que Moi, accès Tout le monde), puis coller l\'adresse /exec dans l\'appli › Réglages › Alertes.');
}

// Chaque matin vers 8 h : alerte à l'équipe (comptes admin) s'il reste des prestations pas faites ou des demandes sans réponse.
function rappelDuMatin() {
  const verrou = LockService.getScriptLock();
  if (!verrou.tryLock(30000)) { console.warn('Rappel du matin reporté : un autre passage est en cours.'); return; }
  try {
    const aujourdhui = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd');
    const msg = messageRappel(oublisDuMatin(demandesOuvertes(), aujourdhui, new Date().toISOString()));
    if (!msg) { console.log('Rien d\'oublié ce matin.'); return; }
    abonnements().filter((a) => a.role === 'admin').forEach((a) => envoyer(a, msg));
    console.log(msg.titre);
  } finally { verrou.releaseLock(); }
}
// À lancer une fois (bouton ▶) : programme le rappel tous les jours vers 8 h, heure de Paris.
function installerRappelDuMatin() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'rappelDuMatin').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('rappelDuMatin').timeBased().atHour(8).nearMinute(0).everyDays(1).inTimezone('Europe/Paris').create();
  console.log('Prêt. Le rappel part chaque matin vers 8 h. Pour l\'essayer tout de suite : choisis rappelDuMatin puis ▶ Exécuter.');
}

if (typeof module === 'object' && module.exports) {
  module.exports = { EC, ecMul, creerCles, signerES256, jetonVapid, base64url, depuisBase64url, texteVersOctets, serviceAutorise, aAnnoncer, problemesAAnnoncer, messagePrestataire, messageEquipe, oublisDuMatin, messageRappel, depuisFirestore, docVersObjet, marqueVersFirestore };
}
