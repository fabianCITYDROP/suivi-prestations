// Sauvegarde automatique de Suivi prestations, chaque semaine, dans le Google Drive de Fabian.
//
// À coller dans un projet Google Apps Script ouvert avec le compte Google PROPRIÉTAIRE du projet Firebase
// « suivi-prestations » (mode d'emploi : apps-script/LISEZMOI-sauvegarde.md).
//
// Chaque lundi matin, le script lit TOUTES les collections de la base (demandes, prestataires, comptes, réglages…)
// et range dans le dossier Drive « Sauvegardes Suivi prestations » :
//   - un Google Sheet lisible (un onglet par collection, une ligne par document) ;
//   - un fichier .json, copie exacte, qui sert à remettre une demande supprimée par erreur.
// Les 12 dernières semaines sont gardées, les plus anciennes partent à la corbeille de Drive.
//
// Aucun mot de passe ni clé ici : le script lit la base avec le compte Google qui l'exécute
// (le propriétaire du projet Firebase). Il ne modifie jamais la base, sauf la fonction `restaurer`,
// lancée à la main, qui recrée UN document supprimé et refuse d'écraser un document existant.

const PROJET = 'suivi-prestations';
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/' + PROJET + '/databases/(default)/documents';
const DOSSIER = 'Sauvegardes Suivi prestations';
const SEMAINES_GARDEES = 12;
const CELLULE_MAX = 2000; // les photos (texte très long) ne sont pas recopiées dans le Sheet, seulement dans le .json

// ---------- fonctions pures (testées dans sauvegarde.test.js) ----------

// Valeur Firestore ({stringValue: "x"}, {mapValue: …}…) → valeur JavaScript simple.
function valeur(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('bytesValue' in v) return '(données binaires)';
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valeur);
  if ('mapValue' in v) return champs(v.mapValue.fields);
  return null;
}
function champs(fields) {
  const o = {};
  Object.keys(fields || {}).forEach((k) => { o[k] = valeur(fields[k]); });
  return o;
}

// Texte d'une cellule : objets en JSON, textes trop longs (photos) remplacés par une mention.
function cellule(v) {
  if (v === null || v === undefined) return '';
  let t = typeof v === 'object' ? JSON.stringify(v) : v;
  if (typeof t === 'string' && t.length > CELLULE_MAX) t = '(trop long : voir le fichier .json)';
  if (typeof t === 'string' && /^[=+\-@]/.test(t)) t = "'" + t; // jamais lu comme une formule
  return t;
}

// Documents d'une collection → tableau pour le Sheet : 1re ligne = noms des colonnes, « id » d'abord.
function tableau(docs) {
  const lignes = docs.map((d) => champs(d.fields));
  const cles = [];
  lignes.forEach((l) => Object.keys(l).forEach((k) => { if (cles.indexOf(k) < 0) cles.push(k); }));
  const prems = ['plaque', 'service', 'statut', 'date', 'debut', 'fin', 'prestataire', 'site'];
  cles.sort((a, b) => {
    const ia = prems.indexOf(a), ib = prems.indexOf(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return a.localeCompare(b);
  });
  const id = (d) => String(d.name).split('/').pop();
  return [['id'].concat(cles)].concat(docs.map((d, i) => [id(d)].concat(cles.map((k) => cellule(lignes[i][k])))));
}

// Noms des sauvegardes trop anciennes à jeter (les noms commencent par la date AAAA-MM-JJ).
function aJeter(noms, garder) {
  const dates = noms.map((n) => (String(n).match(/^Sauvegarde (\d{4}-\d{2}-\d{2})/) || [])[1]).filter(Boolean);
  const gardees = dates.filter((d, i) => dates.indexOf(d) === i).sort().reverse().slice(0, garder);
  return noms.filter((n) => { const d = (String(n).match(/^Sauvegarde (\d{4}-\d{2}-\d{2})/) || [])[1]; return d && gardees.indexOf(d) < 0; });
}

// ---------- lecture de la base (compte Google du propriétaire) ----------

function appel(url, options) {
  const o = Object.assign({ muteHttpExceptions: true, contentType: 'application/json' }, options || {});
  o.headers = Object.assign({
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    'X-Goog-User-Project': PROJET, // le quota est compté sur le projet Firebase, où l'API Firestore est déjà activée
  }, o.headers || {});
  const r = UrlFetchApp.fetch(url, o);
  const code = r.getResponseCode();
  if (code >= 300) throw new Error('Firestore ' + code + ' : ' + r.getContentText().slice(0, 300));
  return JSON.parse(r.getContentText() || '{}');
}

function collections() {
  const ids = [];
  let jeton = '';
  do {
    const r = appel(FIRESTORE + ':listCollectionIds', { method: 'post', payload: JSON.stringify({ pageSize: 100, pageToken: jeton || undefined }) });
    (r.collectionIds || []).forEach((c) => ids.push(c));
    jeton = r.nextPageToken || '';
  } while (jeton);
  return ids.sort();
}

function documents(collection) {
  const docs = [];
  let jeton = '';
  do {
    const r = appel(FIRESTORE + '/' + encodeURIComponent(collection) + '?pageSize=300' + (jeton ? '&pageToken=' + encodeURIComponent(jeton) : ''));
    (r.documents || []).forEach((d) => docs.push(d));
    jeton = r.nextPageToken || '';
  } while (jeton);
  return docs;
}

function dossier() {
  const it = DriveApp.getFoldersByName(DOSSIER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DOSSIER);
}

// ---------- la sauvegarde ----------

function sauvegarder() {
  const jour = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const nom = 'Sauvegarde ' + jour;
  const copie = { projet: PROJET, date: new Date().toISOString(), collections: {} };
  const ss = SpreadsheetApp.create(nom);
  const resume = [['Collection', 'Documents']];

  collections().forEach((c) => {
    const docs = documents(c);
    copie.collections[c] = docs.map((d) => ({ id: String(d.name).split('/').pop(), fields: d.fields || {} }));
    resume.push([c, docs.length]);
    const t = tableau(docs);
    const feuille = ss.insertSheet(c.slice(0, 90));
    feuille.getRange(1, 1, t.length, t[0].length).setNumberFormat('@').setValues(t);
    feuille.setFrozenRows(1);
    feuille.getRange(1, 1, 1, t[0].length).setFontWeight('bold');
  });

  const accueil = ss.getSheets()[0];
  accueil.setName('Résumé');
  resume.push([], ['Sauvegarde du', copie.date], ['Copie exacte', nom + '.json (même dossier)']);
  resume.forEach((l) => { while (l.length < 2) l.push(''); });
  accueil.getRange(1, 1, resume.length, 2).setValues(resume);
  accueil.getRange(1, 1, 1, 2).setFontWeight('bold');

  const d = dossier();
  DriveApp.getFileById(ss.getId()).moveTo(d);
  d.createFile(nom + '.json', JSON.stringify(copie), 'application/json');

  // Ne garder que les dernières semaines.
  const fichiers = [];
  const it = d.getFiles();
  while (it.hasNext()) fichiers.push(it.next());
  const jeter = aJeter(fichiers.map((f) => f.getName()), SEMAINES_GARDEES);
  fichiers.forEach((f) => { if (jeter.indexOf(f.getName()) >= 0) f.setTrashed(true); });

  const total = resume.slice(1).reduce((s, l) => s + (typeof l[1] === 'number' ? l[1] : 0), 0);
  console.log('Sauvegarde faite : ' + total + ' documents, ' + ss.getUrl());
}

// À lancer UNE fois : crée la sauvegarde du lundi matin (vers 6 h) et en fait une tout de suite.
function installer() {
  ScriptApp.getProjectTriggers().forEach((t) => { if (t.getHandlerFunction() === 'sauvegarder') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sauvegarder').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).create();
  sauvegarder();
}

// ---------- remettre un document supprimé par erreur (à la main) ----------
// 1. Ouvrir la dernière sauvegarde, trouver la ligne de la demande, copier son « id » (1re colonne).
// 2. Écrire ci-dessous la collection et l'id, puis choisir la fonction `restaurer` et ▶ Exécuter.
// Le document revient tel qu'il était le jour de la sauvegarde. S'il existe encore, rien n'est écrasé.
const A_RESTAURER = { collection: 'demandes', id: '' };

function restaurer() {
  if (!A_RESTAURER.id) throw new Error('Écris l’id du document à remettre dans A_RESTAURER.');
  const it = dossier().getFiles();
  let derniere = null;
  while (it.hasNext()) {
    const f = it.next();
    if (/^Sauvegarde \d{4}-\d{2}-\d{2}\.json$/.test(f.getName()) && (!derniere || f.getName() > derniere.getName())) derniere = f;
  }
  if (!derniere) throw new Error('Aucune sauvegarde .json dans le dossier « ' + DOSSIER + ' ».');
  const copie = JSON.parse(derniere.getBlob().getDataAsString());
  const doc = (copie.collections[A_RESTAURER.collection] || []).filter((d) => d.id === A_RESTAURER.id)[0];
  if (!doc) throw new Error('« ' + A_RESTAURER.id + ' » n’est pas dans ' + derniere.getName() + '.');
  const url = FIRESTORE + '/' + encodeURIComponent(A_RESTAURER.collection) + '/' + encodeURIComponent(doc.id) + '?currentDocument.exists=false';
  appel(url, { method: 'patch', payload: JSON.stringify({ fields: doc.fields }) });
  console.log('Remis : ' + A_RESTAURER.collection + '/' + doc.id + ' (depuis ' + derniere.getName() + ')');
}

if (typeof module !== 'undefined') module.exports = { valeur, champs, cellule, tableau, aJeter };
