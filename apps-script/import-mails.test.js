// node --test apps-script : lit un vrai mail City-Drop (partie utile, anonymisée).
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("./import-mails.js");

const CORPS = `<html><head><style>p{margin:0}</style></head><body><!-- Header --><div><p>Bonjour,</p><br/>
<p>Nous souhaitons une intervention sur notre <b>M20H-DVL</b> entre le <b>12/11/2026 18:30</b> et le <b>12/11/2026 22:00</b>.</p><br/>
<p>Le véhicule est immatriculé : <b>GS-487-PR</b> (119570 KM).</p><p>Nous souhaitons une intervention pour :<br/>- Lavage extérieur<br/>- Lavage intérieur<br/><br/><br/></p>
<p>Nom du garage : Du sol au toit 78&amp;92</p><br/><p>Nous vous remercions par avance !</p></div></body></html>`;

test("un mail de lavage devient une demande complète", () => {
  assert.deepEqual(M.lireMail("Prise de rendez-vous GS-487-PR", CORPS), {
    source: "mail", statut: "envoyee", service: "lavage", plaque: "GS-487-PR", modeleMail: "M20H-DVL", km: 119570,
    date: "2026-11-12", debut: "18:30", dateFin: "2026-11-12", fin: "22:00",
    tache: "Lavage extérieur + Lavage intérieur", garageMail: "Du sol au toit 78&92",
  });
});

test("le service se déduit des lignes d'intervention", () => {
  assert.equal(M.serviceDe(["Remplacement pare-brise"]), "pare-brise");
  assert.equal(M.serviceDe(["Lavage extérieur", "AdBlue"]), "intervention");
  assert.equal(M.serviceDe([]), "intervention");
  assert.equal(M.serviceDe(["Contrôle hayon"]), "hayon");
  assert.equal(M.serviceDe(["Vérification du haillon"]), "hayon");
  assert.equal(M.serviceDe([], "DHOLLIANDA Trappes"), "hayon");
});

test("un mail qui n'a pas la forme attendue est laissé de côté", () => {
  assert.equal(M.lireMail("Prise de rendez-vous GS-487-PR", "<p>Bonjour, merci</p>"), null);
  assert.equal(M.lireMail("Prise de rendez-vous AB-123-CD", CORPS), null, "plaque du sujet différente du corps");
});

test("seul un mail signé city-drop.com est accepté", () => {
  const bon = "Authentication-Results: mx.google.com;\r\n       dkim=pass header.i=@city-drop.com header.s=google header.b=X;\r\nFrom: <gestion-flotte@city-drop.com>\r\nSubject: x\r\n\r\ncorps";
  assert.ok(M.vientDeCityDrop(bon));
  assert.ok(!M.vientDeCityDrop(bon.replace("dkim=pass", "dkim=fail")));
  assert.ok(!M.vientDeCityDrop(bon.replace("From: <gestion-flotte@city-drop.com>", "From: <pirate@exemple.fr>")));
  // Un faux en-tête placé plus bas par l'expéditeur ne compte pas : seul le premier (ajouté par Gmail) est lu.
  const faux = "Authentication-Results: mx.google.com;\r\n       dkim=fail header.i=@exemple.fr;\r\nFrom: <gestion-flotte@city-drop.com>\r\nAuthentication-Results: x; dkim=pass header.i=@city-drop.com\r\n\r\ncorps";
  assert.ok(!M.vientDeCityDrop(faux));
});

test("la demande part au format Firestore", () => {
  const doc = M.versFirestore({ plaque: "GS-487-PR", km: 119570, dateFin: null, sentAt: "2026-11-10T10:00:00.000Z" });
  assert.deepEqual(doc.fields.plaque, { stringValue: "GS-487-PR" });
  assert.deepEqual(doc.fields.km, { integerValue: "119570" });
  assert.deepEqual(doc.fields.dateFin, { nullValue: null });
  assert.equal(doc.fields.sentAt.stringValue, "2026-11-10T10:00:00.000Z");
});

const ANNULATION = `<div><p>Bonjour,</p><br/><p>Nous souhaitons annuler l&#39;intervention sur notre <b>MOV - 12</b> initialement prévue entre le <b>07/10/2026 08:00</b> et le <b>07/10/2026 20:00</b>.</p><br/>
<p>Le véhicule est immatriculé : <b>GM-961-LC</b>.</p><p>Nom du garage : Du sol au toit 78&amp;92</p><br/><p>Nous vous remercions par avance.</p></div>`;

test("un mail d'annulation donne la plaque et le créneau annulés", () => {
  assert.deepEqual(M.lireAnnulation("Annulation de rendez-vous", ANNULATION),
    { plaque: "GM-961-LC", date: "2026-10-07", debut: "08:00", dateFin: "2026-10-07", fin: "20:00" });
  assert.equal(M.lireAnnulation("Prise de rendez-vous GS-487-PR", CORPS), null);
  assert.equal(M.lireMail("Annulation de rendez-vous", ANNULATION), null, "une annulation ne crée jamais de demande");
});

test("rendez-vous et annulation visent la même demande", () => {
  const rdv = M.lireMail("Prise de rendez-vous GS-487-PR", CORPS);
  assert.equal(M.idDemande(rdv), "mail-GS487PR-20261112-1830");
  assert.equal(M.idDemande(M.lireAnnulation("Annulation de rendez-vous", ANNULATION.replace("GM-961-LC", "GS-487-PR").replaceAll("07/10/2026 08:00", "12/11/2026 18:30"))), M.idDemande(rdv));
});

test("le robot laisse une trace toutes les 30 minutes, ou dès que quelque chose change", () => {
  const t0 = new Date("2026-11-18T12:00:00Z");
  const plus = (min) => new Date(t0.getTime() + min * 60000);
  const avant = M.etatSuivant({}, t0, null, "2026-11-18T09:00:00.000Z");
  avant.ecrit = t0.toISOString();
  assert.equal(M.traceAEcrire(avant, M.etatSuivant(avant, plus(5), null, null), plus(5)), false, "rien de neuf");
  assert.equal(M.traceAEcrire(avant, M.etatSuivant(avant, plus(30), null, null), plus(30)), true, "30 minutes passées");
  assert.equal(M.traceAEcrire(avant, M.etatSuivant(avant, plus(5), null, "2026-11-18T12:04:00.000Z"), plus(5)), true, "nouveau mail");
  assert.equal(M.traceAEcrire(avant, M.etatSuivant(avant, plus(5), "Connexion refusée", null), plus(5)), true, "nouvelle erreur");
  assert.equal(M.etatSuivant(avant, plus(5), null, "2026-11-17T08:00:00.000Z").dernierMail, "2026-11-18T09:00:00.000Z", "garde le plus récent");
});

test("une panne envoie une alerte, relancée toutes les 6 heures, puis « reparti »", () => {
  const t0 = new Date("2026-11-18T12:00:00Z");
  const plus = (h) => new Date(t0.getTime() + h * 3600000);
  const ok = M.etatSuivant({}, t0, null, null);
  const panne = M.etatSuivant(ok, plus(0.1), "Connexion du robot refusée", null);
  assert.equal(M.alerteAEnvoyer(ok, panne, plus(0.1)), "panne");
  assert.equal(panne.erreurDepuis, plus(0.1).toISOString());
  panne.alerte = plus(0.1).toISOString();
  const encore = M.etatSuivant(panne, plus(1), "Connexion du robot refusée", null);
  assert.equal(encore.erreurDepuis, panne.erreurDepuis, "la panne garde sa date de début");
  assert.equal(M.alerteAEnvoyer(panne, encore, plus(1)), null, "pas de mail toutes les 5 minutes");
  assert.equal(M.alerteAEnvoyer(panne, M.etatSuivant(panne, plus(6.2), "x", null), plus(6.2)), "panne", "relance après 6 h");
  const reparti = M.etatSuivant(panne, plus(2), null, null);
  assert.equal(M.alerteAEnvoyer(panne, reparti, plus(2)), "reparti");
  assert.equal(reparti.erreur, null);
  assert.equal(M.alerteAEnvoyer(ok, M.etatSuivant(ok, plus(1), null, null), plus(1)), null);
});

test("la trace envoyée à l'appli n'a que les champs autorisés par les règles", () => {
  const e = { ...M.etatSuivant({}, new Date("2026-11-18T12:00:00Z"), null, null), ecrit: "x", alerte: "y" };
  assert.deepEqual(Object.keys(M.champsTrace(e)), ["passage", "dernierMail", "erreur", "erreurDepuis", "nonCompris", "nonComprisLe"]);
});

test("le « Commentaire : » du mail devient la remarque que voit le prestataire", () => {
  const avec = CORPS.replace("- Lavage intérieur<br/>", "- Lavage intérieur<br/>- Diag<br/></p><p>Commentaire : Voyant moteur allumé,<br/>merci de regarder &amp; nous dire</p><p>")
  const d = M.lireMail("Prise de rendez-vous GS-487-PR", avec);
  assert.equal(d.notes, "Voyant moteur allumé, merci de regarder & nous dire");
  assert.equal(d.tache, "Lavage extérieur + Lavage intérieur + Diag", "le commentaire n'est pas une ligne d'intervention");
  assert.equal(d.service, "intervention");
  assert.equal(d.garageMail, "Du sol au toit 78&92");
  const apres = CORPS.replace("Du sol au toit 78&amp;92</p>", "Du sol au toit 78&amp;92</p><p>Commentaire : Passer avant 10 h</p>");
  assert.equal(M.lireMail("Prise de rendez-vous GS-487-PR", apres).notes, "Passer avant 10 h", "commentaire placé après le garage");
  assert.equal(M.lireMail("Prise de rendez-vous GS-487-PR", apres).garageMail, "Du sol au toit 78&92");
  const vide = CORPS.replace("<p>Nom du garage", "<p>Commentaire : </p><p>Nom du garage");
  assert.ok(!("notes" in M.lireMail("Prise de rendez-vous GS-487-PR", vide)), "commentaire vide = rien");
  assert.ok(!("notes" in M.lireMail("Prise de rendez-vous GS-487-PR", CORPS)), "pas de commentaire = rien");
  assert.equal(M.commentaireDe("Commentaire : " + "x".repeat(800)).length, 500);
});

test("une annulation n'annule que ce qui n'est pas encore fait, et prévient sinon", () => {
  const a = M.lireAnnulation("Annulation de rendez-vous", ANNULATION);
  assert.deepEqual(M.decisionAnnulation(a, { statut: "envoyee", retour: { etat: "" } }), { annuler: true, alerte: null });
  assert.deepEqual(M.decisionAnnulation(a, { statut: "confirmee", retour: { etat: "confirme" } }), { annuler: true, alerte: null });
  assert.deepEqual(M.decisionAnnulation(a, { statut: "annulee", retour: { etat: "" } }), { annuler: false, alerte: null });
  const introuvable = M.decisionAnnulation(a, null);
  assert.equal(introuvable.annuler, false);
  assert.match(introuvable.alerte.sujet, /à faire à la main : GM-961-LC/);
  assert.match(introuvable.alerte.texte, /07\/10\/2026 à 08:00/);
  const faite = M.decisionAnnulation(a, { statut: "realisee", prestataire: "Du Sol au Toit", retour: { etat: "fait" } });
  assert.equal(faite.annuler, false);
  assert.match(faite.alerte.texte, /Du Sol au Toit l'a déjà marqué fait/);
  assert.equal(M.decisionAnnulation(a, { statut: "confirmee", retour: { etat: "fait" } }).annuler, false, "fait mais statut pas encore suivi");
});

test("la demande relue garde seulement statut, prestataire et réponse", () => {
  assert.deepEqual(M.lireFiche({ statut: { stringValue: "realisee" }, prestataire: { stringValue: "Khalid" }, plaque: { stringValue: "X" },
    retour: { mapValue: { fields: { etat: { stringValue: "fait" } } } } }), { statut: "realisee", prestataire: "Khalid", retour: { etat: "fait" } });
  assert.deepEqual(M.lireFiche({ statut: { stringValue: "envoyee" } }), { statut: "envoyee", prestataire: "", retour: { etat: "" } });
});
