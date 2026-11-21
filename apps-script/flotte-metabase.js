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

const moinsJours = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

// ancien = { PLAQUE: [code, catégorie, site, vuLe] } déjà dans l'appli ; nouveau = vehiculesDeLExport(...).
// Les véhicules du jour sont ajoutés ou mis à jour ; les absents gardent leurs infos jusqu'à 60 jours sans être vus.
function fusionnerFlotte(ancien, nouveau, aujourdhui, joursMax = FLOTTE_JOURS_ABSENT) {
  const limite = moinsJours(aujourdhui, joursMax);
  const sortie = {};
  Object.entries(ancien || {}).forEach(([cle, v]) => { if (Array.isArray(v) && (v[3] || '') >= limite) sortie[cle] = v.slice(0, 4); });
  Object.entries(nouveau || {}).forEach(([cle, v]) => { sortie[cle] = [v[0], v[1], v[2], aujourdhui]; });
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
  const nouveau = vehiculesDeLExport(onglet.getDataRange().getDisplayValues(), aujourdhui);
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
  console.log('Flotte Metabase : ' + Object.keys(nouveau).length + ' véhicules dans l\'export, ' + Object.keys(fusion).length + ' gardés dans l\'appli.');
}

// À lancer une seule fois (bouton ▶) : crée le déclencheur de chaque matin et fait une première synchro.
function installerFlotte() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'synchroFlotte').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('synchroFlotte').timeBased().everyDays(1).atHour(FLOTTE_HEURE).inTimezone('Europe/Paris').create();
  synchroFlotte();
}

if (typeof module === 'object' && module.exports) module.exports = { vehiculesDeLExport, fusionnerFlotte, clePlaque };
