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

test("the photo sheet stays close to a square so WhatsApp keeps each photo large", () => {
  const groups = [{ label: "Master", ratios: [4 / 3, 4 / 3, 4 / 3] }];
  const layout = D.photoSheetLayout(groups, D.squareSheetOptions(groups, { width: 2048, pad: 20, gap: 12, header: 72 }));
  const rows = new Set(layout.tiles.map((t) => t.y)).size;
  assert.equal(rows, 2, "3 photos on 2 rows, not one strip");
  assert.ok(layout.height / layout.width > 0.7 && layout.height / layout.width < 1.3);
  assert.ok(Math.min(...layout.tiles.map((t) => t.width)) > 900, "each photo keeps about half the width");
});

test("two photos go one above the other, where WhatsApp keeps them largest", () => {
  const groups = [{ label: "Master", ratios: [4 / 3, 4 / 3] }];
  const layout = D.photoSheetLayout(groups, D.squareSheetOptions(groups, { width: 2048, pad: 20, gap: 12, header: 72 }));
  assert.equal(new Set(layout.tiles.map((t) => t.y)).size, 2);
});

test("photoSheetLayout keeps proportions, fills rows and never overlaps", () => {
  const layout = D.photoSheetLayout([{ label: "Master", ratios: [4 / 3, 3 / 4, 4 / 3] }, { label: "Maxus", ratios: [16 / 9] }]);
  assert.equal(layout.headers.length, 2);
  assert.equal(layout.tiles.length, 4);
  layout.tiles.forEach((t) => {
    assert.ok(t.x >= 0 && t.x + t.width <= layout.width && t.y + t.height <= layout.height);
    const ratio = [[4 / 3, 3 / 4, 4 / 3], [16 / 9]][t.group][t.index];
    assert.ok(Math.abs(t.width / t.height - ratio) < 0.02, "no crop");
  });
  const sorted = [...layout.tiles].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    assert.ok(b.y >= a.y + a.height || b.x >= a.x + a.width, "no overlap");
  }
  assert.ok(layout.headers[1].y > Math.max(...layout.tiles.filter((t) => t.group === 0).map((t) => t.y + t.height)));
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

test("providerId turns a provider name into a stable id", () => {
  assert.equal(D.providerId("ALLO pare-brise 78"), "allo-pare-brise-78");
  assert.equal(D.providerId("  Du sol au toit "), "du-sol-au-toit");
  assert.equal(D.providerId("Lavage Éclair"), "lavage-eclair");
  assert.equal(D.providerId(""), "");
});

test("priceFor picks the most specific price line, in HT", () => {
  const prices = [
    { service: "pare-brise", cubageMin: 3, cubageMax: 6, prixHT: 266.67 },
    { service: "pare-brise", cubageMin: 12, cubageMax: 20, prixHT: 300 },
    { service: "lavage", prixHT: 37 },
  ];
  assert.equal(D.priceFor(prices, demande({ cubage: 12 })), 300);
  assert.equal(D.priceFor(prices, demande({ cubage: 3 })), 266.67);
  assert.equal(D.priceFor(prices, demande({ cubage: 9 })), null);
  assert.equal(D.priceFor(prices, demande({ service: "lavage", cubage: 20 })), 37);
  assert.equal(D.priceFor([...prices, { service: "lavage", cubageMin: 12, prixHT: 45 }], demande({ service: "lavage", cubage: 20 })), 45);
  assert.equal(D.priceFor([], demande()), null);
  assert.equal(D.withVat(266.67), 320);
  assert.equal(D.priceLineLabel(prices[1]), "Pare-brise · 12 à 20 m³");
});

test("providerFields freezes the price until provider, service or cubage changes", () => {
  const prices = { "allo-pare-brise-78": [{ service: "pare-brise", prixHT: 300 }] };
  const pricesOf = (id) => prices[id] || [];
  const first = D.providerFields(demande(), null, pricesOf);
  assert.deepEqual(first, { prestataireId: "allo-pare-brise-78", prixHT: 300 });
  prices["allo-pare-brise-78"] = [{ service: "pare-brise", prixHT: 999 }];
  assert.equal(D.providerFields(demande(), { ...demande(), ...first }, pricesOf).prixHT, 300);
  assert.equal(D.providerFields(demande({ cubage: 20 }), { ...demande(), ...first }, pricesOf).prixHT, 999);
  assert.deepEqual(D.providerFields(demande({ prestataire: "Khalid" }), { ...demande(), ...first }, pricesOf), { prestataireId: "khalid", prixHT: null });
});

test("accessMigration links old requests to their provider once", () => {
  const pricesOf = () => [{ service: "pare-brise", prixHT: 300 }];
  const rows = [
    { id: "a", ...demande() },
    { id: "b", ...demande(), prestataireId: "allo-pare-brise-78", prixHT: 280 },
    { id: "c", ...demande(), prestataire: "" },
  ];
  assert.deepEqual(D.accessMigration(rows, pricesOf), [{ id: "a", prestataireId: "allo-pare-brise-78", prixHT: 300 }]);
  const unpriced = [{ id: "d", ...demande(), prestataireId: "allo-pare-brise-78", prixHT: null }];
  assert.deepEqual(D.accessMigration(unpriced, () => []), [], "no price yet: nothing to do");
  assert.deepEqual(D.accessMigration(unpriced, pricesOf), [{ id: "d", prestataireId: "allo-pare-brise-78", prixHT: 300 }], "price entered later fills it");
});

test("accounts are keyed by lower-case e-mail", () => {
  assert.equal(D.emailKey("  Khalid@Exemple.FR "), "khalid@exemple.fr");
  assert.ok(D.isEmail("a@b.fr"));
  assert.ok(!D.isEmail("pas un mail"));
  assert.equal(D.roleOf("prestataire").id, "prestataire");
  assert.equal(D.roleOf("chef"), null);
});

test("the provider validates new requests, then sees accepted ones each day the vehicle is on site", () => {
  const rows = [
    { id: "a", ...demande({ date: "2026-11-04", statut: "a_envoyer" }) },
    { id: "b", ...demande({ date: "2026-11-05" }) },
    { id: "c", ...demande({ date: "2026-11-02", dateFin: "2026-11-04", statut: "confirmee" }) },
    { id: "g", ...demande({ date: "2026-11-06", retour: { etat: "confirme" } }) },
    { id: "h", ...demande({ date: "2026-10-30", statut: "confirmee" }) },
    { id: "d", ...demande({ date: "2026-11-01", retour: { etat: "fait", at: "2026-11-02T10:00:00Z" } }) },
    { id: "e", ...demande({ statut: "annulee" }) },
    { id: "f", ...demande({ date: "2026-10-20", statut: "realisee", doneAt: "2026-10-21T09:00:00Z" }) },
  ];
  const lists = D.providerLists(rows, "2026-11-03");
  assert.deepEqual(lists.validate.map((d) => d.id), ["a", "b"], "shown as soon as saved, even before the WhatsApp message");
  assert.deepEqual(lists.today.map((d) => d.id), ["h", "c"], "on site today, and late ones");
  assert.deepEqual(lists.upcoming.map((d) => d.id), ["g"]);
  assert.deepEqual(lists.done.map((d) => d.id), ["d", "f"]);
  assert.ok(D.isLate(rows[4], "2026-11-03"));
  assert.ok(!D.isLate(rows[2], "2026-11-03"));
  assert.deepEqual(D.providerCounts(rows, "2026-11-03"), { month: 1, year: 2 });
});

test("a provider answer closes or confirms the request once", () => {
  assert.equal(D.statusFromAnswer(demande({ retour: { etat: "fait" } })), "realisee");
  assert.equal(D.statusFromAnswer(demande({ retour: { etat: "fait", applique: true } })), null);
  assert.equal(D.statusFromAnswer(demande({ statut: "realisee", retour: { etat: "fait" } })), null);
  assert.equal(D.statusFromAnswer(demande({ retour: { etat: "confirme" } })), "confirmee");
  assert.equal(D.statusFromAnswer(demande({ statut: "confirmee", retour: { etat: "confirme" } })), null);
  assert.equal(D.statusFromAnswer(demande({ retour: { etat: "absent" } })), null);
  assert.equal(D.statusFromAnswer(demande()), null);
});

test("unseen answers come newest first and read as a sentence", () => {
  const rows = [
    { id: "a", ...demande({ retour: { etat: "fait", at: "2026-11-03T08:00:00Z" } }) },
    { id: "b", ...demande({ retour: { etat: "autre-date", date: "2026-11-06", debut: "14:00", at: "2026-11-03T09:00:00Z" } }) },
    { id: "c", ...demande({ retour: { etat: "absent", at: "2026-11-03T10:00:00Z", vu: true } }) },
  ];
  assert.deepEqual(D.unseenAnswers(rows).map((d) => d.id), ["b", "a"]);
  assert.equal(D.answerSummary(rows[1].retour), "Autre date proposée : ven. 6 nov. à 14h00");
  assert.equal(D.answerSummary({ etat: "absent", note: "pas sur le parking" }), "Véhicule absent – pas sur le parking");
});

test("interventions are offered only by the providers who do them, and say what to do", () => {
  assert.deepEqual(D.servicesFor(null), ["pare-brise", "lavage"]);
  assert.deepEqual(D.servicesFor({ interventions: false }), ["pare-brise", "lavage"]);
  assert.deepEqual(D.servicesFor({ interventions: true }), ["pare-brise", "lavage", "intervention"]);
  const job = demande({ service: "intervention", tache: "" });
  assert.ok(D.missingFields(job).includes("ce qu'il faut faire"));
  const ready = { ...job, tache: "AdBlue" };
  assert.deepEqual(D.missingFields(ready), []);
  assert.match(D.requestMessage(ready, 0), /Demande intervention véhicule/);
  assert.match(D.requestMessage(ready, 0), /À faire : \*AdBlue\*/);
  assert.match(D.requestMessage(ready, 0, [{ ...ready, plaque: "ZZ-999-ZZ" }]), /À faire : \*AdBlue\*/);
});

test("the same job for the same vehicle on an overlapping day is caught as a duplicate", () => {
  const rows = [
    { id: "a", ...demande({ plaque: "AB-123-CD", service: "lavage", date: "2026-11-05", dateFin: "2026-11-07" }) },
    { id: "b", ...demande({ plaque: "EF-456-GH", service: "lavage", date: "2026-11-05", statut: "annulee" }) },
    { id: "c", ...demande({ plaque: "IJ-789-KL", service: "intervention", tache: "AdBlue", date: "2026-11-05" }) },
  ];
  const ask = (fields) => D.existingDuplicate({ ...demande(), ...fields }, rows)?.id || null;
  assert.equal(ask({ plaque: "ab123cd", service: "lavage", date: "2026-11-06" }), "a", "same plate, same service, inside the window");
  assert.equal(ask({ plaque: "AB-123-CD", service: "pare-brise", date: "2026-11-06" }), null, "another service is fine");
  assert.equal(ask({ plaque: "AB-123-CD", service: "lavage", date: "2026-11-08" }), null, "another day is fine");
  assert.equal(ask({ plaque: "EF-456-GH", service: "lavage", date: "2026-11-05" }), null, "a cancelled request does not count");
  assert.equal(ask({ plaque: "IJ-789-KL", service: "intervention", tache: "adblue", date: "2026-11-05" }), "c");
  assert.equal(ask({ plaque: "IJ-789-KL", service: "intervention", tache: "Ampoule", date: "2026-11-05" }), null, "another task is fine");
  assert.equal(D.existingDuplicate({ ...demande(), plaque: "AB-123-CD", service: "lavage", date: "2026-11-06" }, rows, ["a"]), null, "the request being edited is ignored");
});

test("parseSiteList reads a pasted spreadsheet with multi-line quoted addresses", () => {
  const text = 'Aulnay \n"Parking City-Drop\nSecteur numéro 2\n93606 Aulnay-sous-Bois"\n\nParis - La Défense\t"Rue des Hautes Pâtures\nRue des Peupliers\n92000 Nanterre"\n\nBordeaux - Ouest\t"Entre le 2 - 9 Avenue Maurice Lévy\n\n33700 Merignac"';
  assert.deepEqual(D.parseSiteList(text), [
    { nom: "Aulnay", adresse: "Parking City-Drop, Secteur numéro 2, 93606 Aulnay-sous-Bois" },
    { nom: "Paris - La Défense", adresse: "Rue des Hautes Pâtures, Rue des Peupliers, 92000 Nanterre" },
    { nom: "Bordeaux - Ouest", adresse: "Entre le 2 - 9 Avenue Maurice Lévy, 33700 Merignac" },
  ]);
  assert.deepEqual(D.parseSiteList("Meaux\tRue Georges Claude, 77100 Meaux"), [{ nom: "Meaux", adresse: "Rue Georges Claude, 77100 Meaux" }]);
});

test("mergeSites keeps existing names, fills addresses and adds new sites once", () => {
  const existing = [{ nom: "La Défense", adresse: "" }, { nom: "Paris-Centre", adresse: "old" }, { nom: "Aulnay", adresse: "" }];
  const { sites, added, updated } = D.mergeSites(existing, [
    { nom: "Paris - La Défense", adresse: "92000 Nanterre" },
    { nom: "Paris - Centre", adresse: "75007 Paris" },
    { nom: "Aulnay", adresse: "93606 Aulnay" },
    { nom: "Paris - Aulnay", adresse: "93606 Aulnay" },
    { nom: "Montpellier - Sud", adresse: "34470 Pérols" },
    { nom: "Montpellier - Nord", adresse: "34170 Castelnau" },
  ]);
  assert.deepEqual(sites.map((s) => s.nom), ["La Défense", "Paris-Centre", "Aulnay", "Montpellier - Sud", "Montpellier - Nord"]);
  assert.equal(sites[0].adresse, "92000 Nanterre");
  assert.equal(added, 2); assert.equal(updated, 3);
});

test("a mail request gets its provider, model, site and price from the app", () => {
  const mail = { id: "mail-1", source: "mail", plaque: "GS-487-PR", service: "lavage", garageMail: "Du sol au toit 78&92", date: "2026-11-12" };
  const ctx = {
    demandes: [mail, demande({ id: "old", plaque: "GS487PR", site: "Coignières", adresse: "", date: "2026-10-01" }), demande({ id: "older", plaque: "GS-487-PR", site: "Aulnay", date: "2026-09-01" })],
    vehicleOf: (p) => (D.plateKey(p) === "GS487PR" ? { modele: "Renault Master 2025", cubage: 20 } : null),
    providerNames: ["ALLO pare-brise 78", "Du sol au toit", "Khalid"],
    pricesOf: (id) => (id === "du-sol-au-toit" ? [{ service: "lavage", prixHT: 37 }] : []),
  };
  assert.deepEqual(D.mailCompletion(mail, ctx), { prestataire: "Du sol au toit", modele: "Renault Master 2025", cubage: 20, site: "Coignières", adresse: "", prestataireId: "du-sol-au-toit", prixHT: 37 });
  const done = { ...mail, ...D.mailCompletion(mail, ctx) };
  assert.equal(D.mailCompletion(done, ctx), null, "nothing more to add once completed");
  assert.equal(D.mailCompletion(demande({}), ctx), null, "requests typed in the app are left alone");
});

test("the garage named in a mail is matched to a provider of the app", () => {
  const names = ["ASG BDX LAVAGE", "Khalid Lavage", "DSAT (du sol au toit)", "Lavage Rouag", "Allo Pare brise"];
  assert.equal(D.providerFromGarage("Du sol au toit 78&92", names), "DSAT (du sol au toit)");
  assert.equal(D.providerFromGarage("ALLO pare-brise 78", names), "Allo Pare brise");
  assert.equal(D.providerFromGarage("Khalid", names), "Khalid Lavage");
  assert.equal(D.providerFromGarage("Garage inconnu", names), "");
  assert.equal(D.providerFromGarage("Lavage", names), "", "a generic word alone matches nobody");
});

test("editing an imported request keeps what lets a later mail cancel it", () => {
  assert.deepEqual(D.mailMarkers({ source: "mail", mailId: "mail-X", garageMail: "DSAT", km: 1, plaque: "X", statut: "envoyee" }),
    { source: "mail", mailId: "mail-X", garageMail: "DSAT", km: 1 });
});
