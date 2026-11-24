// Véhicules de l'export Metabase → Suivi prestations (modèle, cubage, site par plaque).
//
// À ajouter comme 2e fichier dans le projet Apps Script « Robot mails » (Fichiers › + › Script, nommé flotte-metabase),
// à côté de import-mails.js dont il reprend la connexion du robot (seConnecter, firestore, versFirestore, FIRESTORE).
// Mode d'emploi : apps-script/LISEZMOI-flotte-metabase.md.
//
// L'export Metabase arrive par mail sur le compte des Runners, dont le script le range dans la feuille
// « Runners - données », onglet Planning (une ligne par réservation). Chaque matin vers 6 h, ce script lit cet onglet
// (en lecture seule : la feuille est partagée en « Lecteur » avec la boîte du robot), garde par plaque le code modèle,
// la catégorie (= cubage) et le site où se trouve le VU, et écrit le tout dans UN document de l'appli : metabase/flotte.
//
// L'export ne liste que les véhicules qui ont une réservation : un VU absent un jour n'est pas forcément vendu.
// Il garde donc ses dernières infos, et n'est retiré qu'après 60 jours sans apparaître (vendu ou rendu).
// Rien d'autre n'est copié : ni kilométrage, ni client, ni trajet.

const FLOTTE_ONGLET = 'Planning';
const FLOTTE_JOURS_ABSENT = 60;
const FLOTTE_HEURE = 6;

// ---------- fonctions pures (testées dans flotte-metabase.test.js) ----------
const clePlaque = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const jourIso = (v) => String(v || '').trim().slice(0, 10);

// valeurs = l'onglet Planning en texte (1re ligne = titres). Renvoie { PLAQUE: [code, catégorie, site] }.
// Site = où arrive la dernière réservation déjà commencée ; à défaut, d'où part la prochaine.
function vehiculesDeLExport(valeurs, aujourdhui) {
  const titres = (valeurs[0] || []).map((t) => String(t).trim().toLowerCase());
  const col = (nom) => titres.indexOf(nom);
  const c = { plaque: col('plaque'), modele: col('modele'), categorie: col('categorie'), villeDepart: col('ville_depart'),
    dateDepart: col('date_depart'), villeArrivee: col('ville_arrivee') };
  if ([c.plaque, c.modele, c.categorie, c.dateDepart, c.villeArrivee].some((i) => i < 0)) throw new Error('Onglet Planning : colonnes plaque/modele/categorie/date_depart/ville_arrivee introuvables.');
  const parPlaque = {};
  valeurs.slice(1).forEach((l) => {
    const cle = clePlaque(l[c.plaque]);
    const code = String(l[c.modele] || '').trim();
    const categorie = String(l[c.categorie] || '').trim();
    if (!cle || !code || !categorie) return;
    (parPlaque[cle] = parPlaque[cle] || []).push({ code, categorie, depart: jourIso(l[c.dateDepart]),
      villeDepart: c.villeDepart >= 0 ? String(l[c.villeDepart] || '').trim() : '', villeArrivee: String(l[c.villeArrivee] || '').trim() });
  });
  const sortie = {};
  Object.keys(parPlaque).sort().forEach((cle) => {
    const lignes = parPlaque[cle].sort((a, b) => a.depart.localeCompare(b.depart));
    const passees = lignes.filter((l) => l.depart && l.depart <= aujourdhui);
    const derniere = passees[passees.length - 1];
    const site = derniere ? derniere.villeArrivee : (lignes[0].villeDepart || lignes[0].villeArrivee);
    const ref = derniere || lignes[0];
    sortie[cle] = [ref.code, ref.categorie, site || ''];
  });
  return sortie;
}

// lignes = le CSV « Runners planning » joint au mail Metabase (Utilities.parseCsv), 1re ligne = titres.
// Il a le modèle et la catégorie de CHAQUE véhicule, y compris les immobilisés que la feuille des Runners ne garde pas.
// Renvoie { PLAQUE: [code, catégorie, matrice] } (les villes n'y sont que des numéros : le site vient de la feuille).
// 3e valeur (facultative) = l'année de la version du modèle : celle de la matrice entretien (« Movano 2023 »),
// sinon celle de la 1re mise en circulation (colonne « 1ere Mec », « 31/05/2023 »).
function vehiculesDuCsv(lignes) {
  const titres = (lignes[0] || []).map((t) => String(t).replace(/^\uFEFF/, '').trim());
  const col = (fin) => titres.findIndex((t) => new RegExp('(^|→\\s*)' + fin + '$', 'i').test(t));
  const c = { plaque: col('Immatriculation'), modele: col('Modele'), categorie: col('Categorie') };
  // Matrice entretien du back-office (« Movano 2023 ») : n'importe quelle colonne dont le titre parle de matrice, sauf son ID
  // (avec une jointure Metabase, le titre peut être « Cd Matrices - Matrice → Nom »).
  const iMatrice = titres.findIndex((t) => /matrice/i.test(t) && !/\bid$/i.test(t));
  const iMec = col('1ere Mec');
  const annee = (l) => [iMatrice, iMec].map((i) => (i >= 0 ? (/\b(20\d\d)\b/.exec(String(l[i] || '')) || [])[1] : '')).find(Boolean) || '';
  if (Object.values(c).some((i) => i < 0)) throw new Error('CSV Metabase : colonnes Immatriculation/Modele/Categorie introuvables.');
  const sortie = {};
  lignes.slice(1).forEach((l) => {
    const cle = clePlaque(l[c.plaque]);
    const code = String(l[c.modele] || '').trim();
    const categorie = String(l[c.categorie] || '').trim();
    const matrice = annee(l);
    if (cle && code && categorie) sortie[cle] = [code, categorie, matrice];
  });
  return sortie;
}
// Le CSV fait foi pour le modèle et la catégorie ; la feuille donne le site quand elle le connaît.
function completerAvecCsv(nouveau, csv) {
  const sortie = { ...(nouveau || {}) };
  Object.entries(csv || {}).forEach(([cle, [code, categorie, matrice]]) => {
    sortie[cle] = [code, categorie, (sortie[cle] || [])[2] || ''];
    if (matrice) sortie[cle][4] = matrice;
  });
  return sortie;
}

const moinsJours = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

// ancien = { PLAQUE: [code, catégorie, site, vuLe, matrice?] } déjà dans l'appli ; nouveau = vehiculesDeLExport(...).
// Les véhicules du jour sont ajoutés ou mis à jour ; les absents gardent leurs infos jusqu'à 60 jours sans être vus.
function fusionnerFlotte(ancien, nouveau, aujourdhui, joursMax = FLOTTE_JOURS_ABSENT) {
  const limite = moinsJours(aujourdhui, joursMax);
  const sortie = {};
  Object.entries(ancien || {}).forEach(([cle, v]) => { if (Array.isArray(v) && (v[3] || '') >= limite) sortie[cle] = v.slice(0, 5); });
  Object.entries(nouveau || {}).forEach(([cle, v]) => {
    const matrice = v[4] || (sortie[cle] || [])[4] || ''; // une matrice connue n'est pas perdue un jour où le CSV manque
    sortie[cle] = matrice ? [v[0], v[1], v[2], aujourdhui, matrice] : [v[0], v[1], v[2], aujourdhui];
  });
  return Object.fromEntries(Object.keys(sortie).sort().map((k) => [k, sortie[k]]));
}

// ---------- ce qui tourne dans Apps Script ----------
function synchroFlotte() {
  const props = PropertiesService.getScriptProperties();
  const aujourdhui = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd');
  const feuille = props.getProperty('METABASE_FEUILLE'); // identifiant de « Runners - données », jamais écrit dans le code public
  if (!feuille) throw new Error('Propriété du script METABASE_FEUILLE manquante (identifiant de la feuille « Runners - données »).');
  const onglet = SpreadsheetApp.openById(feuille).getSheetByName(FLOTTE_ONGLET);
  if (!onglet) throw new Error('Onglet « ' + FLOTTE_ONGLET + ' » introuvable dans « Runners - données ».');
  const csv = csvDuMail(props);
  const nouveau = completerAvecCsv(vehiculesDeLExport(onglet.getDataRange().getDisplayValues(), aujourdhui), csv);
  if (Object.keys(nouveau).length < 20) throw new Error('Export Metabase presque vide (' + Object.keys(nouveau).length + ' véhicules) : rien changé dans l\'appli.');
  const jeton = seConnecter(props);
  const lu = UrlFetchApp.fetch(FIRESTORE + '/metabase/flotte', { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + jeton } });
  let ancien = {};
  if (lu.getResponseCode() === 200) ancien = JSON.parse(((JSON.parse(lu.getContentText()).fields || {}).donnees || {}).stringValue || '{}');
  else if (lu.getResponseCode() !== 404) throw new Error('Lecture de metabase/flotte refusée (' + lu.getResponseCode() + ') : republier les règles Firestore ?');
  const fusion = fusionnerFlotte(ancien, nouveau, aujourdhui);
  const donnees = JSON.stringify(fusion);
  const corps = versFirestore({ majLe: new Date().toISOString(), nb: Object.keys(fusion).length, donnees });
  const r = firestore('patch', '/metabase/flotte?' + masque(['majLe', 'nb', 'donnees']), jeton, corps);
  if (r.getResponseCode() !== 200) throw new Error('Écriture de metabase/flotte refusée (' + r.getResponseCode() + ') : ' + r.getContentText().slice(0, 200));
  console.log('Flotte Metabase : ' + Object.keys(nouveau).length + ' véhicules dans l\'export (' + Object.keys(csv).length + ' lus dans le CSV du mail), ' + Object.keys(fusion).length + ' gardés dans l\'appli.');
}

// Le dernier mail Metabase « Runners planning » reçu par la boîte du robot (abonnement Metabase), s'il y en a un de moins de 2 jours.
// METABASE_EXPEDITEUR (facultatif) : n'accepter que les mails de cette adresse. Sans mail : la feuille seule, comme avant.
function csvDuMail(props) {
  const de = props.getProperty('METABASE_EXPEDITEUR');
  const fils = GmailApp.search((de ? 'from:' + de + ' ' : '') + 'has:attachment filename:csv subject:"Runners" newer_than:2d', 0, 5);
  const messages = fils.flatMap((f) => f.getMessages()).sort((a, b) => b.getDate() - a.getDate());
  for (const m of messages) {
    if (de && !String(m.getFrom()).toLowerCase().includes(de.toLowerCase())) continue;
    // Le mail peut avoir plusieurs CSV : on prend le premier qui a les colonnes Immatriculation/Modele/Categorie.
    for (const pj of m.getAttachments().filter((a) => /\.csv$/i.test(a.getName()))) {
      try { return vehiculesDuCsv(Utilities.parseCsv(pj.getDataAsString('UTF-8'))); } catch (e) { /* fichier suivant */ }
    }
  }
  console.warn('Pas de mail Metabase « Runners » récent dans la boîte du robot : feuille des Runners seule.');
  return {};
}

// À lancer une seule fois (bouton ▶) : crée le déclencheur de chaque matin et fait une première synchro.
function installerFlotte() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'synchroFlotte').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('synchroFlotte').timeBased().everyDays(1).atHour(FLOTTE_HEURE).inTimezone('Europe/Paris').create();
  synchroFlotte();
}

if (typeof module === 'object' && module.exports) module.exports = { vehiculesDeLExport, vehiculesDuCsv, completerAvecCsv, fusionnerFlotte, clePlaque };
