process.env.TZ = "Europe/Paris";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("./domain.js");

const SITES = [{ nom: "Saint-Cloud", adresse: "1 quai X, Saint-Cloud" }, { nom: "La Défense", adresse: "" }];
const demande = (over) => ({ plaque: "AB-123-CD", modele: "Opel Movano 2023", cubage: 12, site: "La Défense", date: "2026-11-02",
  debut: "09:00", fin: "12:00", prestataire: "ALLO pare-brise 78", statut: "envoyee", service: "pare-brise", ...over });

test("normalizePlate formats SIV plates and leaves others uppercased", () => {
  assert.equal(D.normalizePlate("ab123cd"), "AB-123-CD");
  assert.equal(D.normalizePlate(" ab 123-cd "), "AB-123-CD");
  assert.equal(D.normalizePlate("1234 ab 75"), "1234 AB 75");
});

test("platesInText finds SIV and FNI plates in a provider reply", () => {
  assert.deepEqual(D.platesInText("ok pour AB-123-CD et ef 456 gh, pas 1234 AB 75"), ["AB123CD", "EF456GH", "1234AB75"]);
  assert.deepEqual(D.platesInText("rien ici"), []);
});

test("timeSlotLabel reads as a sentence", () => {
  assert.equal(D.timeSlotLabel({ debut: "09:00", fin: "12:00" }), "de 09h00 à 12h00");
  assert.equal(D.timeSlotLabel({ debut: "09:00" }), "à partir de 09h00");
  assert.equal(D.timeSlotLabel({ fin: "12:00" }), "avant 12h00");
  assert.equal(D.timeSlotLabel({}), "toute la journée");
  assert.equal(D.defaultEndTime("22:30"), "23:30");
});

test("dates are computed in local time", () => {
  assert.equal(D.addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(D.mondayOf("2026-11-01"), "2026-10-26");
});

test("a vehicle blocked several days is available on each of them", () => {
  const d = demande({ date: "2026-11-02", dateFin: "2026-11-04" });
  assert.ok(D.isAvailableOn(d, "2026-11-03"));
  assert.ok(!D.isAvailableOn(d, "2026-11-05"));
  assert.ok(D.isAvailableOn(demande({ dateFin: "" }), "2026-11-02"));
  assert.equal(D.availabilityLabel(d), "du lundi 2 novembre au mercredi 4 novembre");
  assert.equal(D.availabilityLabel(demande({})), "le lundi 2 novembre 2026");
});

test("fleet labels and sites", () => {
  assert.equal(D.fleetLabel({ modele: "Maxus", cubage: 20 }), "Maxus – 20 m³");
  assert.equal(D.fleetIndex(D.DEFAULT_FLEET, { modele: "Maxus", cubage: "20" }), D.DEFAULT_FLEET.findIndex((f) => f.modele === "Maxus" && f.cubage === 20));
  assert.deepEqual(D.normalizeSites(["Paris-Saint-Cloud", "Paris-Centre", { nom: "Aulnay", adresse: "x" }]),
    [{ nom: "Saint-Cloud", adresse: "" }, { nom: "Paris-Centre", adresse: "" }, { nom: "Aulnay", adresse: "x" }]);
});

test("the fleet is picked by model, then by cubage, with the year only when needed", () => {
  const bases = D.fleetBases(D.DEFAULT_FLEET);
  assert.ok(bases.includes("Opel Movano") && bases.includes("Toyota ProAce") && !bases.some((b) => /\d{4}$/.test(b)));
  assert.deepEqual(D.fleetVariants(D.DEFAULT_FLEET, "Toyota ProAce").map((v) => v.label), ["17 m³"]);
  assert.deepEqual(D.fleetVariants(D.DEFAULT_FLEET, "Maxus").map((v) => v.label), ["12 m³", "20 m³"]);
  assert.deepEqual(D.fleetVariants(D.DEFAULT_FLEET, "Opel Vivaro").map((v) => v.label), ["5 m³ · 2023", "5 m³ · 2025"]);
  const vivaro2025 = D.fleetVariants(D.DEFAULT_FLEET, "Opel Vivaro")[1];
  assert.equal(D.DEFAULT_FLEET[vivaro2025.index].modele, "Opel Vivaro 2025");
});

test("photos are shared by every van of the same model", () => {
  assert.equal(D.modelKey({ modele: "Opel Movano 2023", cubage: 12 }), "OPELMOVANO202312");
  assert.equal(D.modelKey({ modele: "" }), "");
  const list = [{ modele: "Maxus", cubage: 20 }, { modele: "Maxus", cubage: "20" }, { modele: "Maxus", cubage: 12 }, { modele: "" }];
  assert.deepEqual(D.uniqueModels(list).map(D.fleetLabel), ["Maxus – 20 m³", "Maxus – 12 m³"]);
});

test("missingFields checks the availability window", () => {
  assert.deepEqual(D.missingFields(demande({})), []);
  assert.deepEqual(D.missingFields(demande({ site: "", adresse: "" })), ["le site"]);
  assert.deepEqual(D.missingFields(demande({ dateFin: "2026-11-01" })), ["une date de fin après la date de début"]);
  assert.deepEqual(D.missingFields({}), ["l'immatriculation", "la date de disponibilité", "le site", "le prestataire"]);
});

test("statusTimestamps keeps the first sent and confirmed dates", () => {
  const first = D.statusTimestamps(null, "envoyee", "T1");
  assert.deepEqual(first, { sentAt: "T1", confirmedAt: null, doneAt: null });
  const done = D.statusTimestamps(first, "realisee", "T2");
  assert.deepEqual(done, { sentAt: "T1", confirmedAt: "T2", doneAt: "T2" });
  assert.equal(D.statusTimestamps(done, "envoyee", "T3").doneAt, null);
});

test("dayListMessage lists the day's vehicles by site with the site address", () => {
  const list = [
    demande({ plaque: "AA-111-AA", debut: "14:00", fin: "" }),
    demande({ plaque: "BB-222-BB", site: "Saint-Cloud" }),
    demande({ plaque: "CC-333-CC", debut: "08:00", fin: "10:00", date: "2026-11-01", dateFin: "2026-11-03" }),
    demande({ plaque: "DD-444-DD", statut: "annulee" }),
    demande({ plaque: "EE-555-EE", date: "2026-11-03" }),
  ];
  const text = D.dayListMessage(list, { date: "2026-11-02", provider: "ALLO pare-brise 78", sites: SITES });
  assert.match(text, /^\*Véhicules à faire – lundi 2 novembre\*\n3 véhicules pour ALLO pare-brise 78 :/);
  assert.match(text, /\*Saint-Cloud\* – 1 quai X, Saint-Cloud\n• \*BB-222-BB\* – Opel Movano 2023 – 12 m³ – de 09h00 à 12h00/);
  assert.ok(text.indexOf("*Saint-Cloud*") < text.indexOf("*La Défense*"));
  assert.ok(text.indexOf("CC-333-CC") < text.indexOf("AA-111-AA"), "sorted by start time inside a site");
  assert.match(text, /CC-333-CC.*dispo jusqu'au mar\. 3 nov\./);
  assert.doesNotMatch(text, /DD-444-DD|EE-555-EE/);
  assert.equal(D.dayListMessage([], { date: "2026-11-02", sites: SITES }), "Aucun véhicule prévu le lundi 2 novembre.");
});

test("requestMessage describes the vehicle, window and photos", () => {
  const text = D.requestMessage(demande({ dateFin: "2026-11-03", adresse: "Niveau -2" }), 2);
  assert.match(text, /Véhicule : Opel Movano 2023 – 12 m³/);
  assert.match(text, /Disponible du lundi 2 novembre au mardi 3 novembre, de 09h00 à 12h00/);
  assert.match(text, /Site : La Défense – Niveau -2/);
  assert.match(text, /Photos du pare-brise ci-jointes\./);
  assert.doesNotMatch(D.requestMessage(demande({ service: "lavage" }), 0), /pare-brise/);
});

test("requestMessage groups several washes in one message", () => {
  const text = D.requestMessage(demande({ service: "lavage", notes: "Clés à l'accueil" }), 0,
    [demande({ plaque: "EF-456-GH", modele: "Maxus", cubage: 20 }), demande({ plaque: "IJ-789-KL", modele: "", cubage: null })]);
  assert.match(text, /^\*Demande lavage véhicule – 3 véhicules\*\nDisponibles le lundi 2 novembre 2026, de 09h00 à 12h00\nSite : La Défense\n\n/);
  assert.match(text, /• \*AB-123-CD\* – Opel Movano 2023 – 12 m³\n• \*EF-456-GH\* – Maxus – 20 m³\n• \*IJ-789-KL\* – modèle à préciser/);
  assert.match(text, /Remarque : Clés à l'accueil\n\nMerci de confirmer le passage pour chaque véhicule\.$/);
  const mixed = D.requestMessage(demande({ service: "lavage" }), 0, [demande({ plaque: "EF-456-GH", debut: "14:00", fin: "16:00" })]);
  assert.match(mixed, /Disponibles le lundi 2 novembre 2026\n/);
  assert.match(mixed, /EF-456-GH\* – Opel Movano 2023 – 12 m³ – de 14h00 à 16h00/);
  assert.deepEqual(D.duplicatePlates(["AB-123-CD", "ab123cd", "EF-456-GH", ""]), ["ab123cd"]);
});

test("whatsappLink converts French numbers and encodes text", () => {
  assert.equal(D.whatsappLink("a b", "06 12 34 56 78"), "https://wa.me/33612345678?text=a%20b");
  assert.equal(D.whatsappLink("x", "+33 6 12 34 56 78"), "https://wa.me/33612345678?text=x");
  assert.equal(D.whatsappLink("x", ""), "https://wa.me/?text=x");
  assert.equal(D.whatsappLink("a b", "06 12 34 56 78", "app"), "whatsapp://send?phone=33612345678&text=a%20b");
  assert.equal(D.whatsappLink("x", "", "app"), "whatsapp://send?text=x");
  assert.equal(D.whatsappLink("x", "", "web"), "https://web.whatsapp.com/send?text=x");
});

test("collageLayout puts tiles on a grid without overlap", () => {
  const one = D.collageLayout(1);
  assert.equal(one.tiles.length, 1);
  const five = D.collageLayout(5);
  assert.equal(new Set(five.tiles.map((t) => t.x)).size, 3);
  five.tiles.forEach((t) => assert.ok(t.x + t.width <= five.width && t.y + t.caption + t.height <= five.height));
});

test("monthlyReport counts requested, done, cancelled, overdue and upcoming", () => {
  const list = [
    demande({ date: "2026-10-05", statut: "realisee" }),
    demande({ date: "2026-10-06", statut: "annulee" }),
    demande({ date: "2026-10-07", statut: "envoyee" }),
    demande({ date: "2026-10-18", dateFin: "2026-10-22", statut: "confirmee", site: "" }),
    demande({ date: "2026-11-02" }),
  ];
  const r = D.monthlyReport(list, { month: "2026-10", provider: "", todayIso: "2026-10-20" });
  assert.deepEqual(r.total, { requested: 4, done: 1, cancelled: 1, overdue: 1, upcoming: 1, amount: 0 });
  assert.deepEqual(r.bySite.map(([k]) => k).sort(), ["La Défense", D.NO_SITE].sort());
});

test("CSV and TSV exports escape separators", () => {
  assert.equal(D.toCsv([["a;b", 'c"d', "e"]]), '﻿"a;b";"c""d";e');
  assert.equal(D.toTsv([["a\tb", "c\nd"]]), "a b\tc d");
  assert.equal(D.exportRow(demande({})).length, D.EXPORT_HEADER.length);
});

test("matchesSearch ignores dashes, spaces and case", () => {
  assert.ok(D.matchesSearch(["AB-123-CD", "Peugeot"], "ab123"));
  assert.ok(D.matchesSearch(["AB-123-CD"], ""));
  assert.ok(!D.matchesSearch(["AB-123-CD"], "zz"));
});
