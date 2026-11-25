// node --test apps-script : la signature des alertes est vérifiée par la cryptographie de Node,
// et le choix de ce qu'il faut annoncer est rejoué sur des demandes types.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const N = require("./notifications.js");

const outils = {
  sha256: (o) => [...crypto.createHash("sha256").update(Buffer.from(o)).digest()],
  hmac: (k, o) => [...crypto.createHmac("sha256", Buffer.from(k)).update(Buffer.from(o)).digest()],
};
const b64 = (s) => Buffer.from(s, "base64url");

test("la clé publique correspond à la clé privée (comparée à Node)", () => {
  const cles = N.creerCles([...crypto.randomBytes(32)]);
  const pub = b64(cles.publique);
  assert.equal(pub.length, 65);
  assert.equal(pub[0], 4);
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(b64(cles.privee));
  assert.deepEqual(ecdh.getPublicKey(), pub);
});

test("la signature ES256 est acceptée par Node", () => {
  for (let i = 0; i < 5; i++) {
    const cles = N.creerCles([...crypto.randomBytes(32)]);
    const pub = b64(cles.publique);
    const cle = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
    const message = N.texteVersOctets("en-tête.corps " + i + " éà");
    const sig = Buffer.from(N.signerES256(message, cles.privee, outils));
    assert.ok(crypto.verify("sha256", Buffer.from(message), { key: cle, dsaEncoding: "ieee-p1363" }, sig));
    assert.ok(!crypto.verify("sha256", Buffer.from(message.concat([1])), { key: cle, dsaEncoding: "ieee-p1363" }, sig));
  }
});

test("signature identique au vecteur officiel RFC 6979 (P-256, SHA-256, « sample »)", () => {
  const privee = Buffer.from("C9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721", "hex").toString("base64url");
  const sig = Buffer.from(N.signerES256(N.texteVersOctets("sample"), privee, outils)).toString("hex").toUpperCase();
  assert.equal(sig, "EFD48B2AACB6A8FD1140DD9CD45E81D69D2C877B56AAF991C34D0EA84EAF3716" + "F7CB1C942D657C41D436C7A1B6E29F65F3E900DBB9AFF4064DC4AB2F843ACDA8");
});

test("le laissez-passer VAPID vise le bon service", () => {
  const cles = N.creerCles([...crypto.randomBytes(32)]);
  const v = N.jetonVapid("https://web.push.apple.com/QGuQ…", cles, 1_700_000_000, outils);
  const [, jwt, k] = v.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, cles.publique);
  const corps = JSON.parse(b64(jwt.split(".")[1]).toString());
  assert.equal(corps.aud, "https://web.push.apple.com");
  assert.equal(corps.exp, 1_700_000_000 + 12 * 3600);
  assert.match(corps.sub, /^https:\/\//);
});

test("seuls les vrais services d'alertes sont appelés", () => {
  assert.ok(N.serviceAutorise("https://fcm.googleapis.com/fcm/send/abc"));
  assert.ok(N.serviceAutorise("https://web.push.apple.com/abc"));
  assert.ok(N.serviceAutorise("https://updates.push.services.mozilla.com/wpush/v2/abc"));
  assert.ok(N.serviceAutorise("https://wns2-par02p.notify.windows.com/w/?token=abc"));
  assert.ok(!N.serviceAutorise("https://exemple.fr/fcm.googleapis.com/"));
  assert.ok(!N.serviceAutorise("https://fcm.googleapis.com.pirate.fr/x"));
  assert.ok(!N.serviceAutorise("http://fcm.googleapis.com/x"));
  assert.ok(!N.serviceAutorise(undefined));
});

const DEPUIS = "2026-11-19T08:00:00.000Z";
const base = { id: "d1", plaque: "GS-487-PR", service: "lavage", site: "Saint-Cloud", date: "2026-11-20", prestataire: "Khalid", prestataireId: "khalid", statut: "envoyee", createdAt: "2026-11-19T09:00:00.000Z" };

test("une nouvelle demande est annoncée une seule fois à son prestataire", () => {
  const a = N.aAnnoncer([base], DEPUIS);
  assert.deepEqual(a.prestataires, { khalid: { nouvelles: ["GS-487-PR · Lavage · Saint-Cloud · 20/11"], valides: [], annulees: [] } });
  assert.deepEqual(a.marques, [{ id: "d1", notifie: { demande: "khalid", annulee: false } }]);
  const encore = N.aAnnoncer([{ ...base, notifie: a.marques[0].notifie }], DEPUIS);
  assert.deepEqual(encore.prestataires, {});
  assert.deepEqual(encore.marques, []);
});

test("rien d'antérieur à l'installation, rien sans prestataire", () => {
  assert.deepEqual(N.aAnnoncer([{ ...base, createdAt: "2026-11-01T09:00:00.000Z" }], DEPUIS).marques, []);
  assert.deepEqual(N.aAnnoncer([{ ...base, prestataireId: undefined }], DEPUIS).marques, []);
  assert.deepEqual(N.aAnnoncer([{ ...base, statut: "annulee" }], DEPUIS).marques, [], "annulée avant d'avoir été annoncée");
});

test("changement de prestataire, annulation, puis replanification", () => {
  const autre = N.aAnnoncer([{ ...base, prestataireId: "dsat", notifie: { demande: "khalid", annulee: false } }], DEPUIS);
  assert.deepEqual(Object.keys(autre.prestataires), ["dsat"]);
  const annulee = N.aAnnoncer([{ ...base, statut: "annulee", notifie: { demande: "khalid", annulee: false } }], DEPUIS);
  assert.deepEqual(annulee.prestataires.khalid.annulees, ["GS-487-PR · Lavage · Saint-Cloud · 20/11"]);
  assert.deepEqual(annulee.marques[0].notifie, { demande: "khalid", annulee: true });
  const replan = N.aAnnoncer([{ ...base, notifie: { demande: "khalid", annulee: true } }], DEPUIS);
  assert.equal(replan.prestataires.khalid.nouvelles.length, 1);
});

test("une réponse du prestataire est annoncée à l'équipe, une fois par réponse", () => {
  const r = { etat: "fait", at: "2026-11-19T10:00:00.000Z", par: "k@x.fr", note: "intérieur aussi" };
  const notifie = { demande: "khalid", annulee: false };
  const a = N.aAnnoncer([{ ...base, notifie, retour: r }], DEPUIS);
  assert.deepEqual(a.equipe, ["Khalid a fait GS-487-PR : intérieur aussi"]);
  assert.deepEqual(a.marques[0].notifie, { ...notifie, retour: r.at });
  assert.deepEqual(N.aAnnoncer([{ ...base, notifie: a.marques[0].notifie, retour: r }], DEPUIS).equipe, []);
  const ensuite = N.aAnnoncer([{ ...base, notifie: a.marques[0].notifie, retour: { etat: "autre-date", at: "2026-11-19T11:00:00.000Z", date: "2026-11-22", debut: "09:00" } }], DEPUIS);
  assert.deepEqual(ensuite.equipe, ["Khalid propose une autre date pour GS-487-PR : le 22/11 à 09:00"]);
});

test("textes des alertes", () => {
  assert.deepEqual(N.messagePrestataire({ nouvelles: ["A"], annulees: [] }), { titre: "Nouvelle demande", texte: "A", url: "./" });
  assert.equal(N.messagePrestataire({ nouvelles: ["A", "B"], annulees: ["C"] }).titre, "2 nouvelles demandes · Demande annulée");
  assert.equal(N.messagePrestataire({ nouvelles: ["A", "B"], annulees: ["C"] }).texte, "A\nB\nAnnulée : C");
  assert.equal(N.messageEquipe(["x", "y"]).titre, "2 retours des prestataires");
  assert.equal(N.messageEquipe(["x"]).url, "./#retours");
  assert.equal(N.messagePrestataire({ nouvelles: ["1", "2", "3", "4", "5", "6"], annulees: [] }).texte.split("\n").length, 6);
});

test("un problème signalé sur un véhicule est annoncé à l'équipe, une seule fois", () => {
  const s = { id: "s1", demandeId: "d1", plaque: "GS-487-PR", type: "pneu", texte: "arrière gauche à plat", statut: "nouveau", at: "2026-11-19T10:00:00.000Z" };
  const maintenant = "2026-11-19T10:01:00.000Z";
  const a = N.problemesAAnnoncer([s], {}, "2026-11-19T08:00:00.000Z", maintenant, () => "Khalid");
  assert.deepEqual(a.lignes, ["Khalid signale un problème sur GS-487-PR : Pneu – arrière gauche à plat"]);
  assert.deepEqual(a.vus, { s1: s.at });
  assert.deepEqual(N.problemesAAnnoncer([s], a.vus, "2026-11-19T08:00:00.000Z", maintenant, () => "Khalid").lignes, [], "pas deux fois");
  assert.deepEqual(N.problemesAAnnoncer([s], {}, "2026-11-19T10:30:00.000Z", maintenant, () => "Khalid").lignes, [], "rien d'avant l'installation");
  assert.deepEqual(N.problemesAAnnoncer([{ ...s, statut: "traite" }], {}, "2026-11-19T08:00:00.000Z", maintenant, () => "Khalid").lignes, [], "déjà traité");
  assert.equal(N.problemesAAnnoncer([{ ...s, type: "voyant", texte: "" }], {}, "2026-11-19T08:00:00.000Z", maintenant, () => "").lignes[0], "Un prestataire signale un problème sur GS-487-PR : Voyant allumé");
  // La liste des déjà-annoncés ne grossit pas : les anciens sont oubliés au bout d'une heure.
  assert.deepEqual(N.problemesAAnnoncer([], { vieux: "2026-11-19T08:00:00.000Z", recent: "2026-11-19T09:30:00.000Z" }, "2026-11-19T08:00:00.000Z", maintenant, () => "").vus, { recent: "2026-11-19T09:30:00.000Z" });
  // Nouveaux signalements : juste le texte du prestataire.
  assert.equal(N.problemesAAnnoncer([{ ...s, type: "autre", texte: "rétro droit cassé" }], {}, "2026-11-19T08:00:00.000Z", maintenant, () => "Khalid").lignes[0], "Khalid signale un problème sur GS-487-PR : rétro droit cassé");
  assert.equal(N.messageEquipe([], ["p"]).titre, "Problème signalé sur un véhicule");
  assert.equal(N.messageEquipe(["r"], ["p", "q"]).titre, "2 problèmes signalés sur des véhicules · Retour d'un prestataire");
  assert.equal(N.messageEquipe(["r"], ["p"]).texte, "p\nr");
});

test("lecture et écriture au format Firestore", () => {
  const doc = { name: "projects/p/databases/(default)/documents/demandes/d1", fields: {
    plaque: { stringValue: "AB" }, km: { integerValue: "12" }, retour: { mapValue: { fields: { etat: { stringValue: "fait" }, vu: { booleanValue: true } } } }, x: { nullValue: null },
  } };
  assert.deepEqual(N.docVersObjet(doc), { id: "d1", plaque: "AB", km: 12, retour: { etat: "fait", vu: true }, x: null });
  assert.deepEqual(N.marqueVersFirestore({ demande: "k", annulee: false, retour: "t" }), { fields: { notifie: { mapValue: { fields: { demande: { stringValue: "k" }, annulee: { booleanValue: false }, retour: { stringValue: "t" } } } } } });
});

test("rappel du matin : prestations pas faites", () => {
  const auj = "2026-11-19", maintenant = "2026-11-19T07:00:00.000Z";
  const o = (l) => N.oublisDuMatin(l, auj, maintenant);
  const vieille = { ...base, id: "a", date: "2026-11-10", plaque: "AA-111-AA" };
  const hier = { ...base, id: "b", date: "2026-11-18", plaque: "BB-222-BB", prestataire: undefined };
  assert.deepEqual(o([hier, vieille]).pasFaites, ["AA-111-AA · Lavage · Saint-Cloud · 10/11 (Khalid)", "BB-222-BB · Lavage · Saint-Cloud · 18/11"], "la plus ancienne d'abord");
  assert.deepEqual(o([{ ...base, date: "2026-11-19" }]).pasFaites, [], "aujourd'hui n'est pas encore passé");
  assert.deepEqual(o([{ ...vieille, dateFin: "2026-11-20" }]).pasFaites, [], "période pas encore terminée");
  assert.equal(o([{ ...vieille, dateFin: "2026-11-15" }]).pasFaites.length, 1, "période terminée");
  assert.deepEqual(o([{ ...vieille, service: "hayon" }]), { pasFaites: [], sansReponse: [] });
  assert.deepEqual(o([{ ...vieille, retour: { etat: "fait", at: "2026-11-11T10:00:00.000Z" } }]), { pasFaites: [], sansReponse: [] });
  assert.deepEqual(o([{ ...vieille, statut: "annulee" }, { ...vieille, statut: "realisee" }]), { pasFaites: [], sansReponse: [] });
});

test("rappel du matin : demandes sans réponse depuis 24 h", () => {
  const auj = "2026-11-19", maintenant = "2026-11-19T08:00:00.000Z";
  const o = (l) => N.oublisDuMatin(l, auj, maintenant);
  const d = { ...base, date: "2026-11-25" };
  assert.deepEqual(o([{ ...d, createdAt: "2026-11-18T09:00:00.000Z" }]).sansReponse, [], "23 h : trop tôt");
  assert.deepEqual(o([{ ...d, createdAt: "2026-11-18T07:00:00.000Z" }]).sansReponse, ["GS-487-PR · Lavage · Saint-Cloud · 25/11 (Khalid)"], "25 h");
  assert.equal(o([{ ...d, createdAt: "2026-11-01T00:00:00.000Z", sentAt: "2026-11-18T09:00:00.000Z" }]).sansReponse.length, 0, "sentAt préféré à createdAt");
  assert.equal(o([{ ...d, createdAt: "2026-11-18T09:00:00.000Z", sentAt: "2026-11-17T09:00:00.000Z" }]).sansReponse.length, 1, "sentAt préféré à createdAt");
  assert.deepEqual(o([{ ...d, createdAt: "2026-11-10T00:00:00.000Z", retour: { etat: "autre-date", at: "2026-11-11T00:00:00.000Z" } }]).sansReponse, [], "une réponse suffit");
  assert.deepEqual(o([{ ...d, createdAt: "2026-11-10T00:00:00.000Z", prestataireId: undefined }]).sansReponse, []);
  assert.deepEqual(o([{ ...d, createdAt: "2026-11-10T00:00:00.000Z", statut: "confirmee" }]).sansReponse, []);
  const vieux = { ...base, date: "2026-11-10", createdAt: "2026-11-05T00:00:00.000Z" };
  const r = o([vieux]);
  assert.equal(r.pasFaites.length, 1);
  assert.deepEqual(r.sansReponse, [], "pas en double");
  const a = { ...d, id: "x", plaque: "XX", createdAt: "2026-11-15T00:00:00.000Z" }, b = { ...d, id: "y", plaque: "YY", createdAt: "2026-11-12T00:00:00.000Z" };
  assert.deepEqual(o([a, b]).sansReponse.map((l) => l.slice(0, 2)), ["YY", "XX"], "la plus ancienne d'abord");
});

test("textes du rappel du matin", () => {
  assert.equal(N.messageRappel({ pasFaites: [], sansReponse: [] }), null);
  assert.deepEqual(N.messageRappel({ pasFaites: ["A"], sansReponse: [] }), { titre: "Rappel du matin : 1 prestation pas faite", texte: "Pas faite : A", url: "./" });
  assert.equal(N.messageRappel({ pasFaites: [], sansReponse: ["B"] }).titre, "Rappel du matin : 1 demande sans réponse depuis 24 h");
  const m = N.messageRappel({ pasFaites: ["A", "B"], sansReponse: ["C", "D", "E"] });
  assert.equal(m.titre, "Rappel du matin : 2 prestations pas faites · 3 demandes sans réponse depuis 24 h");
  assert.equal(m.texte, "Pas faite : A\nPas faite : B\nSans réponse : C\nSans réponse : D\nSans réponse : E");
  const long = N.messageRappel({ pasFaites: ["1", "2", "3", "4"], sansReponse: ["5", "6", "7"] });
  assert.equal(long.texte.split("\n").length, 7);
  assert.ok(long.texte.endsWith("\n…"));
  assert.ok(!N.messageRappel({ pasFaites: ["1", "2", "3", "4", "5", "6"], sansReponse: [] }).texte.endsWith("…"));
});

test("rappel du matin : chaque prestataire ne reçoit que ses véhicules", () => {
  const auj = "2026-11-20", maintenant = "2026-11-20T07:00:00.000Z";
  const allo = { ...base, prestataireId: "allo", prestataire: "ALLO", service: "pare-brise", plaque: "AL-001-LO", date: "2026-11-19" };
  const k1 = { ...base, plaque: "KK-001-KK", date: "2026-11-18" };
  const k2 = { ...base, plaque: "KK-002-KK", date: "2026-11-25", createdAt: "2026-11-18T07:00:00.000Z" };
  const fait = { ...base, plaque: "KK-003-KK", date: "2026-11-18", retour: { etat: "fait", at: "2026-11-18T10:00:00.000Z" } };
  const r = N.rappelsPrestataires([allo, k1, k2, fait, { ...k1, prestataireId: undefined }], auj, maintenant);
  assert.deepEqual(Object.keys(r).sort(), ["allo", base.prestataireId].sort());
  assert.equal(r.allo.titre, "Rappel : 1 véhicule sans « Prestation réalisée »");
  assert.ok(!r.allo.texte.includes("KK-"), "rien des autres prestataires");
  const k = r[base.prestataireId];
  assert.equal(k.titre, "Rappel : 1 véhicule sans « Prestation réalisée » · 1 demande à valider");
  assert.equal(k.texte, "Pas faite : KK-001-KK · Lavage · Saint-Cloud · 18/11\nÀ valider : KK-002-KK · Lavage · Saint-Cloud · 25/11");
  assert.deepEqual(N.rappelsPrestataires([fait], auj, maintenant), {});
  for (const etat of ["autre-date", "absent", "refuse"]) {
    assert.deepEqual(N.rappelsPrestataires([{ ...k1, retour: { etat, at: "2026-11-18T10:00:00.000Z" } }], auj, maintenant), {}, etat + " : déjà répondu, l'équipe s'en charge");
  }
});

test("un lavage validé depuis un signalement est annoncé « Lavage validé » à son prestataire", () => {
  const a = N.aAnnoncer([{ ...base, statut: "confirmee", signalementId: "s9" }], DEPUIS);
  assert.deepEqual(a.prestataires.khalid, { nouvelles: [], valides: ["GS-487-PR · Lavage · Saint-Cloud · 20/11"], annulees: [] });
  const m = N.messagePrestataire(a.prestataires.khalid);
  assert.equal(m.titre, "Lavage validé : vous pouvez le faire");
  assert.equal(m.texte, "Validé : GS-487-PR · Lavage · Saint-Cloud · 20/11");
  assert.equal(N.messagePrestataire({ nouvelles: ["A"], valides: ["B", "C"], annulees: [] }).titre, "2 lavages validés : vous pouvez les faire · Nouvelle demande");
});
