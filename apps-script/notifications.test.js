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
  assert.deepEqual(a.prestataires, { khalid: { nouvelles: ["GS-487-PR · Lavage · Saint-Cloud · 20/11"], annulees: [] } });
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
