// Import automatique des mails « Prise de rendez-vous <plaque> » dans Suivi prestations.
//
// À coller dans un projet Google Apps Script ouvert avec la boîte Gmail qui reçoit ces mails
// (mode d'emploi : apps-script/LISEZMOI.md). Toutes les 5 minutes, le script lit les mails
// envoyés par gestion-flotte@city-drop.com, vérifie qu'ils viennent bien de City-Drop (signature
// DKIM), en sort la plaque, le créneau, les interventions et le garage, puis crée la demande dans
// l'appli avec un compte « robot » qui ne peut QUE créer ces demandes : il ne lit rien.
//
// S'il s'arrête, personne ne le verrait : il laisse donc une trace dans l'appli (robot/etat) au moins toutes les
// 30 minutes, et l'appli affiche un bandeau rouge quand cette trace vieillit. Quand il le peut, il envoie aussi
// un mail d'alerte à ALERTE_EMAIL (panne, puis « c'est reparti », et chaque mail qu'il n'a pas su lire).
//
// Le mot de passe du robot n'est jamais écrit ici : il est rangé dans
// Paramètres du projet › Propriétés du script (ROBOT_EMAIL et ROBOT_MOT_DE_PASSE).

const EXPEDITEUR = 'gestion-flotte@city-drop.com';
const RECHERCHE = 'from:' + EXPEDITEUR + ' {subject:"Prise de rendez-vous" subject:"Annulation de rendez-vous"} newer_than:3d';
const FIREBASE_CLE_WEB = 'AIzaSyBIFL2pF1QwaYpyLo2lc8aOwjd1G86Eg8w'; // clé publique de la page web, pas un secret
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/suivi-prestations/databases/(default)/documents';
const DEJA_FAITS = 'mails_importes';
const ETAT = 'etat_robot';
const TRACE_MINUTES = 30;      // l'appli s'inquiète au bout de 2 heures sans trace
const RELANCE_HEURES = 6;      // pendant une panne, un mail d'alerte toutes les 6 heures au plus

// ---------- lecture du mail (fonctions pures, testées dans import-mails.test.js) ----------
function texteDuMail(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, ' ');
}

const dateIso = (jjmmaaaa) => { const [j, m, a] = jjmmaaaa.split('/'); return a + '-' + m.padStart(2, '0') + '-' + j.padStart(2, '0'); };

// Les lignes « - Lavage extérieur » disent le service : contrôle hayon, que du lavage, du pare-brise, sinon une intervention.
function serviceDe(taches, garage) {
  if (taches.some((t) => /hayon|haillon/i.test(t)) || /dhol+iand/i.test(String(garage || ''))) return 'hayon';
  if (taches.length && taches.every((t) => /lavage|nettoyage/i.test(t))) return 'lavage';
  if (taches.some((t) => /pare.?brise/i.test(t))) return 'pare-brise';
  return 'intervention';
}

// Renvoie la demande à créer, ou null si le mail n'a pas la forme attendue.
function lireMail(sujet, html) {
  if (!/Prise de rendez-vous/i.test(String(sujet))) return null;
  const texte = texteDuMail(html);
  const plaqueSujet = (String(sujet).match(/Prise de rendez-vous\s+(.+)$/i) || [])[1];
  const creneau = texte.match(/notre\s+(.*?)\s+entre le\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})\s+et le\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})/i);
  const vehicule = texte.match(/immatricul\S*\s*:\s*([A-Z0-9-]+)\s*(?:\((\d[\d\s.]*)\s*km\))?/i);
  const garage = (texte.match(/Nom du garage\s*:\s*(.+)/i) || [])[1];
  const bloc = (texte.match(/intervention pour\s*:([\s\S]*?)(?:Nom du garage|$)/i) || [])[1] || '';
  const taches = bloc.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
  if (!creneau || !vehicule || !garage) return null;
  const plaque = vehicule[1].toUpperCase();
  if (plaqueSujet && plaqueSujet.replace(/[^A-Z0-9]/gi, '').toUpperCase() !== plaque.replace(/[^A-Z0-9]/g, '')) return null;
  const service = serviceDe(taches, garage);
  return {
    source: 'mail', statut: 'envoyee', service, plaque,
    modeleMail: creneau[1].trim(),
    km: vehicule[2] ? Number(vehicule[2].replace(/\D/g, '')) : null,
    date: dateIso(creneau[2]), debut: creneau[3].padStart(5, '0'),
    dateFin: dateIso(creneau[4]), fin: creneau[5].padStart(5, '0'),
    tache: taches.join(' + '),
    garageMail: garage.trim(),
  };
}

// « Annulation de rendez-vous » : même plaque, même créneau que la prise de rendez-vous qu'il annule.
function lireAnnulation(sujet, html) {
  if (!/Annulation de rendez-vous/i.test(String(sujet))) return null;
  const texte = texteDuMail(html);
  const creneau = texte.match(/annuler\s+l.intervention\s+sur\s+notre\s+(.*?)\s+initialement\s+pr\S*\s+entre le\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})\s+et le\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})/i);
  const vehicule = texte.match(/immatricul\S*\s*:\s*([A-Z0-9-]+)/i);
  if (!creneau || !vehicule) return null;
  return { plaque: vehicule[1].toUpperCase(), date: dateIso(creneau[2]), debut: creneau[3].padStart(5, '0'), dateFin: dateIso(creneau[4]), fin: creneau[5].padStart(5, '0') };
}

// Une demande venue d'un mail a un identifiant fixé par la plaque et le début du créneau :
// l'annulation retrouve ainsi la bonne demande sans rien lire dans l'appli.
const idDemande = (d) => ['mail', d.plaque.replace(/[^A-Z0-9]/gi, '').toUpperCase(), d.date.replace(/-/g, ''), d.debut.replace(':', '')].join('-');

// Le mail doit être signé par city-drop.com (DKIM) et venir de l'adresse de la gestion de flotte.
function vientDeCityDrop(brut) {
  const entete = String(brut).split(/\r?\n\r?\n/)[0];
  const de = (entete.match(/^From:.*$/im) || [''])[0].toLowerCase();
  const verifs = (entete.match(/^Authentication-Results:[\s\S]*?(?=\r?\n\S)/im) || [''])[0];
  return de.includes(EXPEDITEUR) && /dkim=pass[^;]*header\.i=@city-drop\.com/i.test(verifs);
}

// ---------- Firestore (format REST) ----------
function versFirestore(demande) {
  const champs = {};
  Object.entries(demande).forEach(([k, v]) => {
    if (v === null || v === undefined) champs[k] = { nullValue: null };
    else if (typeof v === 'number') champs[k] = { integerValue: String(v) };
    else champs[k] = { stringValue: String(v) };
  });
  return { fields: champs };
}

// ---------- surveillance du robot (fonctions pures, testées) ----------
// etat = ce que le robot retient d'un passage à l'autre : { passage, dernierMail, erreur, erreurDepuis, ecrit, alerte }.
function etatSuivant(avant, maintenant, erreur, dernierMail) {
  const iso = maintenant.toISOString();
  const plusRecent = [avant.dernierMail, dernierMail].filter(Boolean).sort().pop() || null;
  return {
    ...avant, passage: iso, dernierMail: plusRecent,
    erreur: erreur ? String(erreur).slice(0, 300) : null,
    erreurDepuis: erreur ? (avant.erreur ? avant.erreurDepuis : iso) : null,
  };
}
// La trace part dans l'appli toutes les 30 minutes, ou tout de suite si quelque chose a changé.
function traceAEcrire(avant, apres, maintenant) {
  return !avant.ecrit || maintenant - new Date(avant.ecrit) >= TRACE_MINUTES * 60000
    || avant.erreur !== apres.erreur || avant.dernierMail !== apres.dernierMail || avant.nonCompris !== apres.nonCompris;
}
// 'panne' au début d'une panne puis toutes les 6 heures, 'reparti' quand elle se termine, sinon null.
function alerteAEnvoyer(avant, apres, maintenant) {
  if (apres.erreur) return !avant.erreur || !avant.alerte || maintenant - new Date(avant.alerte) >= RELANCE_HEURES * 3600000 ? 'panne' : null;
  return avant.erreur && avant.alerte ? 'reparti' : null;
}
const champsTrace = (e) => ({ passage: e.passage, dernierMail: e.dernierMail || null, erreur: e.erreur || null, erreurDepuis: e.erreurDepuis || null,
  nonCompris: e.nonCompris || null, nonComprisLe: e.nonComprisLe || null });

// ---------- ce qui tourne dans Apps Script ----------
function importer() {
  const props = PropertiesService.getScriptProperties();
  const avant = JSON.parse(props.getProperty(ETAT) || '{}');
  const maintenant = new Date();
  const erreurs = [];
  const nonCompris = [];
  let dernierMail = null;
  let jeton = null;
  try {
    const faits = JSON.parse(props.getProperty(DEJA_FAITS) || '[]');
    const aFaire = [];
    GmailApp.search(RECHERCHE, 0, 50).forEach((fil) => fil.getMessages().forEach((m) => {
      const recu = m.getDate().toISOString();
      if (!dernierMail || recu > dernierMail) dernierMail = recu;
      const cle = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, m.getHeader('Message-ID') || m.getId())
        .map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
      if (!faits.includes(cle)) aFaire.push({ cle, m });
    }));
    if (aFaire.length) {
      aFaire.sort((a, b) => a.m.getDate() - b.m.getDate()); // du plus ancien au plus récent : une annulation passe après son rendez-vous
      jeton = seConnecter(props);
      aFaire.forEach(({ cle, m }) => {
        const r = traiter(m, jeton);
        if (r === true) faits.push(cle);
        else if (r && r.nonCompris) { faits.push(cle); nonCompris.push(r.nonCompris); }
        else erreurs.push(r && r.erreur ? r.erreur : 'erreur inconnue');
      });
      props.setProperty(DEJA_FAITS, JSON.stringify(faits.slice(-300)));
    }
  } catch (e) { erreurs.push(e.message); }

  const apres = etatSuivant(avant, maintenant, erreurs[0], dernierMail);
  if (nonCompris.length) { apres.nonCompris = nonCompris[nonCompris.length - 1].slice(0, 200); apres.nonComprisLe = maintenant.toISOString(); }
  if (traceAEcrire(avant, apres, maintenant)) {
    try {
      jeton = jeton || seConnecter(props);
      const champs = champsTrace(apres);
      const r = firestore('patch', '/robot/etat?' + masque(Object.keys(champs)), jeton, versFirestore(champs));
      if (r.getResponseCode() !== 200) throw new Error('Trace refusée par l\'appli (' + r.getResponseCode() + ') : republier les règles Firestore ?');
      apres.ecrit = maintenant.toISOString();
    } catch (e) {
      if (!apres.erreur) { apres.erreur = e.message.slice(0, 300); apres.erreurDepuis = avant.erreur ? avant.erreurDepuis : maintenant.toISOString(); }
    }
  }
  const alerte = alerteAEnvoyer(avant, apres, maintenant);
  if (alerte === 'panne') apres.alerte = maintenant.toISOString();
  if (alerte === 'reparti') apres.alerte = null;
  envoyerAlertes(props, alerte, apres, nonCompris);
  props.setProperty(ETAT, JSON.stringify(apres));
  if (apres.erreur) throw new Error(apres.erreur); // l'exécution apparaît « Échec » dans Apps Script › Exécutions
}

function envoyerAlertes(props, alerte, etat, nonCompris) {
  const a = props.getProperty('ALERTE_EMAIL');
  if (!a) return;
  const envoyer = (sujet, texte) => { try { MailApp.sendEmail(a, sujet, texte + '\n\n— Le robot des mails de Suivi prestations'); } catch (e) { console.error('Alerte non envoyée : ' + e.message); } };
  if (alerte === 'panne') envoyer('⚠️ Robot des mails arrêté : les demandes ne s\'importent plus',
    'Le robot n\'arrive plus à importer les mails City-Drop depuis le ' + Utilities.formatDate(new Date(etat.erreurDepuis), 'Europe/Paris', "dd/MM/yyyy 'à' HH'h'mm") + '.\n\nProblème : ' + etat.erreur
    + '\n\nLes rendez-vous reçus pendant la panne seront importés automatiquement une fois le problème réglé (jusqu\'à 3 jours en arrière).'
    + '\nÀ vérifier : Apps Script › Exécutions pour le détail ; si le mot de passe du robot a changé, le remettre dans Propriétés du script (ROBOT_MOT_DE_PASSE).');
  if (alerte === 'reparti') envoyer('✅ Robot des mails reparti', 'Le robot importe de nouveau les mails City-Drop. Rien à faire.');
  nonCompris.forEach((sujet) => envoyer('Mail City-Drop non compris : ' + sujet,
    'Le robot n\'a pas su lire ce mail : « ' + sujet + ' ». Cette demande n\'est pas dans l\'appli, saisis-la à la main.'));
}

// Renvoie true quand le mail est réglé (même s'il est ignoré), { nonCompris: sujet } si personne ne l'a importé,
// { erreur } pour réessayer au prochain passage.
function traiter(m, jeton) {
  if (!vientDeCityDrop(m.getRawContent())) { console.warn('Ignoré (pas signé City-Drop) : ' + m.getSubject()); return true; }
  const maintenant = new Date().toISOString();
  const annulation = lireAnnulation(m.getSubject(), m.getBody());
  if (annulation) {
    const r = firestore('patch', '/demandes/' + idDemande(annulation) + '?currentDocument.exists=true&' + masque(['statut', 'annuleeAt', 'updatedAt']),
      jeton, versFirestore({ statut: 'annulee', annuleeAt: maintenant, updatedAt: maintenant }));
    const code = r.getResponseCode();
    if (code === 200) console.log('Annulée : ' + annulation.plaque + ' du ' + annulation.date);
    else if (code === 404 || code === 400) console.warn('Annulation sans demande importée (à annuler à la main si besoin) : ' + annulation.plaque + ' du ' + annulation.date);
    else { const erreur = 'Annulation refusée (' + code + ') : ' + r.getContentText().slice(0, 200); console.error(erreur); return { erreur }; }
    return true;
  }
  const demande = lireMail(m.getSubject(), m.getBody());
  if (!demande) { console.warn('Mail non compris, à saisir à la main : ' + m.getSubject()); return { nonCompris: m.getSubject() }; }
  const id = idDemande(demande);
  const fiche = { ...demande, mailId: id, sentAt: maintenant, createdAt: maintenant, updatedAt: maintenant };
  const r = firestore('post', '/demandes?documentId=' + id, jeton, versFirestore(fiche));
  const code = r.getResponseCode();
  if (code === 200) { console.log('Ajoutée : ' + demande.plaque + ' le ' + demande.date); return true; }
  if (code !== 409) { const erreur = 'Refusé (' + code + ') pour ' + demande.plaque + ' : ' + r.getContentText().slice(0, 200); console.error(erreur); return { erreur }; }
  // Même plaque, même créneau : si la demande avait été annulée, ce mail la replanifie.
  const champs = Object.keys(fiche).filter((k) => k !== 'createdAt');
  const re = firestore('patch', '/demandes/' + id + '?currentDocument.exists=true&' + masque(champs), jeton, versFirestore(fiche));
  console.log(re.getResponseCode() === 200 ? 'Replanifiée : ' + demande.plaque + ' le ' + demande.date : 'Déjà là : ' + demande.plaque + ' le ' + demande.date);
  return true;
}

const masque = (champs) => champs.map((c) => 'updateMask.fieldPaths=' + c).join('&');
function firestore(methode, chemin, jeton, corps) {
  return UrlFetchApp.fetch(FIRESTORE + chemin, {
    method: methode, contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + jeton }, payload: JSON.stringify(corps),
  });
}

function seConnecter(props) {
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + FIREBASE_CLE_WEB, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ email: props.getProperty('ROBOT_EMAIL'), password: props.getProperty('ROBOT_MOT_DE_PASSE'), returnSecureToken: true }),
  });
  if (r.getResponseCode() !== 200) throw new Error('Connexion du robot refusée : vérifie ROBOT_EMAIL et ROBOT_MOT_DE_PASSE.');
  return JSON.parse(r.getContentText()).idToken;
}

// À lancer une seule fois (bouton ▶) : crée le déclencheur toutes les 5 minutes.
function installer() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'importer').forEach((t) => ScriptApp.deleteTrigger(t)); // laisse celui des alertes
  ScriptApp.newTrigger('importer').timeBased().everyMinutes(5).create();
  importer();
}

if (typeof module === 'object' && module.exports) module.exports = { texteDuMail, lireMail, lireAnnulation, idDemande, serviceDe, vientDeCityDrop, versFirestore, etatSuivant, traceAEcrire, alerteAEnvoyer, champsTrace };
