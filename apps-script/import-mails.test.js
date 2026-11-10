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
  const doc = M.versFirestore({ plaque: "GS-487-PR", km: 119570, dateFin: null }, "2026-11-10T10:00:00.000Z");
  assert.deepEqual(doc.fields.plaque, { stringValue: "GS-487-PR" });
  assert.deepEqual(doc.fields.km, { integerValue: "119570" });
  assert.deepEqual(doc.fields.dateFin, { nullValue: null });
  assert.equal(doc.fields.sentAt.stringValue, "2026-11-10T10:00:00.000Z");
});
