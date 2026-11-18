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
  assert.match(text, /^\*Demande lavage complet – 3 véhicules\*\nDisponibles le lundi 2 novembre 2026, de 09h00 à 12h00\nSite : La Défense\n\n/);
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

test("windshields go only to the providers ticked Pare-brise, ALLO by default", () => {
  // ALLO never ticked nor unticked: keeps windshields, with or without a provider document.
  assert.deepEqual(D.servicesFor(null, "ALLO pare-brise 78"), ["pare-brise", "lavage"]);
  assert.deepEqual(D.servicesFor({ nom: "ALLO pare-brise 78", interventions: false }), ["pare-brise", "lavage"]);
  assert.equal(D.offers({ nom: "ALLO pare-brise 78" }, "pareBrise"), true);
  // Every other provider gets no windshield unless ticked.
  assert.deepEqual(D.servicesFor({ nom: "DHOLLIANDA", hayon: true }), ["lavage", "hayon"]);
  assert.deepEqual(D.servicesFor(null, "Khalid"), ["lavage"]);
  assert.deepEqual(D.servicesFor({ nom: "Khalid", pareBrise: true }), ["pare-brise", "lavage"]);
  // Unticking ALLO is respected.
  assert.deepEqual(D.servicesFor({ nom: "ALLO pare-brise 78", pareBrise: false }), ["lavage"]);
});

test("interventions are offered only by the providers who do them, and say what to do", () => {
  assert.deepEqual(D.servicesFor(null), ["lavage"]);
  assert.deepEqual(D.servicesFor({ interventions: false }), ["lavage"]);
  assert.deepEqual(D.servicesFor({ interventions: true }), ["lavage", "intervention"]);
  assert.deepEqual(D.servicesFor({ hayon: true }), ["lavage", "hayon"]);
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

test("la réponse du prestataire clôt ou confirme la demande elle-même", () => {
  const at = "2026-11-19T10:00:00.000Z";
  const d = { statut: "envoyee", sentAt: "2026-11-18T08:00:00.000Z" };
  assert.deepEqual(D.answerPatch(d, { etat: "fait", par: "k" }, at), { retour: { etat: "fait", par: "k", at }, updatedAt: at, statut: "realisee", confirmedAt: at, doneAt: at });
  assert.deepEqual(D.answerPatch(d, { etat: "confirme", par: "k" }, at), { retour: { etat: "confirme", par: "k", at }, updatedAt: at, statut: "confirmee", confirmedAt: at });
  assert.deepEqual(D.answerPatch({ ...d, statut: "confirmee", confirmedAt: "x" }, { etat: "fait", par: "k" }, at), { retour: { etat: "fait", par: "k", at }, updatedAt: at, statut: "realisee", doneAt: at });
  assert.deepEqual(D.answerPatch(d, { etat: "absent", par: "k" }, at), { retour: { etat: "absent", par: "k", at }, updatedAt: at });
  assert.deepEqual(D.answerPatch({ ...d, statut: "annulee" }, { etat: "fait", par: "k" }, at), { retour: { etat: "fait", par: "k", at }, updatedAt: at });
});

test("washes are complete unless marked inside only, each with its own price", () => {
  const prices = [
    { service: "lavage", formule: "complet", cubageMin: null, cubageMax: null, prixHT: 42 },
    { service: "lavage", formule: "interieur", cubageMin: null, cubageMax: null, prixHT: 25 },
    { service: "pare-brise", cubageMin: null, cubageMax: null, prixHT: 300 },
  ];
  assert.equal(D.priceFor(prices, { service: "lavage", cubage: 20 }), 42);
  assert.equal(D.priceFor(prices, { service: "lavage", formule: "interieur", cubage: 20 }), 25);
  assert.equal(D.priceFor(prices, { service: "pare-brise", cubage: 20 }), 300);
  assert.equal(D.priceFor([{ service: "lavage", prixHT: 37 }], { service: "lavage", formule: "complet" }), 37, "an older wash line counts as complete");
  assert.equal(D.priceLineLabel(prices[1]), "Lavage intérieur · toutes tailles");
  assert.equal(D.jobLabel({ service: "pare-brise" }), "Pare-brise");
  assert.match(D.requestMessage({ service: "lavage", formule: "interieur", plaque: "AB-123-CD", date: "2026-11-12", dateFin: "2026-11-12" }), /\*Demande lavage intérieur\*/);
  const pricesOf = () => prices;
  const previous = { prestataireId: "khalid", service: "lavage", formule: "complet", cubage: 20, prixHT: 42 };
  assert.equal(D.providerFields({ prestataire: "Khalid", service: "lavage", formule: "interieur", cubage: 20 }, previous, pricesOf).prixHT, 25, "switching to inside re-prices");
});

// ---------- tailgate (hayon) controls ----------
const hayon = (over) => demande({ service: "hayon", prestataire: "DHOLLIANDA", ...over });
const TODAY = "2026-11-18";

test("hayon: next control is 180 days after the last one, from the sheet or a past booking", () => {
  const rows = D.hayonFollowUp([{ plaque: "AB-123-CD", dernierControle: "2026-06-01" }, { plaque: "EF-456-GH", dernierControle: "2026-01-10" }],
    [hayon({ id: "a", plaque: "EF-456-GH", date: "2026-11-10" })], TODAY);
  const ab = rows.find((r) => r.plaque === "AB-123-CD");
  assert.equal(ab.nextDue, "2026-11-28");
  assert.equal(ab.daysLeft, 10);
  assert.equal(ab.level, "bientot");
  const ef = rows.find((r) => r.plaque === "EF-456-GH");
  assert.equal(ef.lastControl, "2026-11-10"); // the booking whose day has passed counts as done
  assert.equal(ef.nextDue, "2027-05-09");
  assert.equal(ef.level, "ok");
  assert.equal(ef.lastRequest.id, "a");
});

test("hayon: levels: past due, 5 days or less (both red on screen), 30 days or less (orange)", () => {
  assert.equal(D.hayonLevel(-1), "depasse");
  assert.equal(D.hayonLevel(0), "urgent");
  assert.equal(D.hayonLevel(5), "urgent");
  assert.equal(D.hayonLevel(6), "bientot");
  assert.equal(D.hayonLevel(30), "bientot");
  assert.equal(D.hayonLevel(31), "ok");
  assert.equal(D.hayonLevel(null), "inconnu");
});

test("hayon: cancelled or not-done bookings do not count, upcoming ones show as booked, most urgent first", () => {
  const rows = D.hayonFollowUp([{ plaque: "AB-123-CD", dernierControle: "2026-05-01" }, { plaque: "EF-456-GH", dernierControle: "2026-06-01" }], [
    hayon({ id: "x", date: "2026-11-01", statut: "annulee" }),
    hayon({ id: "y", date: "2026-11-05", statut: "annulee", nonFait: true }),
    hayon({ id: "z", date: "2026-11-25" }),
  ], TODAY);
  assert.equal(rows[0].plaque, "AB-123-CD");
  assert.equal(rows[0].lastControl, "2026-05-01");
  assert.equal(rows[0].level, "depasse");
  assert.equal(rows[0].booked.id, "z");
  assert.equal(rows[0].notDone.id, "y");
});

test("hayon: only sent or confirmed controls whose day has passed are closed automatically", () => {
  assert.equal(D.hayonAutoClose(hayon({ date: "2026-11-17" }), TODAY), true);
  assert.equal(D.hayonAutoClose(hayon({ date: TODAY }), TODAY), false);
  assert.equal(D.hayonAutoClose(hayon({ date: "2026-11-17", statut: "a_envoyer" }), TODAY), false);
  assert.equal(D.hayonAutoClose(hayon({ date: "2026-11-17", statut: "annulee" }), TODAY), false);
  assert.equal(D.hayonAutoClose(demande({ date: "2026-11-17" }), TODAY), false);
});

test("hayon: warns when the same vehicle is booked twice within a week, or long before it is due", () => {
  const existing = [hayon({ id: "a", date: "2026-11-12" })];
  const [close] = D.hayonWarnings(hayon({ date: "2026-11-15" }), existing, [], TODAY);
  assert.match(close, /déjà posé pour AB-123-CD le .* à 3 jours/);
  assert.deepEqual(D.hayonWarnings(hayon({ id: "a", date: "2026-11-15" }), existing, [], TODAY, ["a"]), []);
  const [early] = D.hayonWarnings(hayon({ date: "2026-12-01" }), existing, [], TODAY);
  assert.match(early, /prochain n'est dû que le/);
  assert.deepEqual(D.hayonWarnings(hayon({ date: "2026-12-01" }), [], [{ plaque: "AB-123-CD", dernierControle: "2026-06-10" }], TODAY), []);
  assert.deepEqual(D.hayonWarnings(demande({ date: "2026-11-15" }), existing, [], TODAY), []);
  const rows = D.hayonFollowUp([], [...existing, hayon({ id: "b", date: "2026-11-15" })], TODAY);
  assert.equal(rows[0].tooSoon.gap, 3);
});

test("hayon: the provider's sheet is read line by line (plate + last control date)", () => {
  const list = D.parseHayonList("Immat\tDernier contrôle\nab-123-cd\t12/05/2026\tOK\nEF456GH  2026-04-03\nGH-789-IJ\n\nAB-123-CD\t01/02/2026");
  assert.deepEqual(list, [
    { plaque: "AB-123-CD", dernierControle: "2026-05-12" },
    { plaque: "EF-456-GH", dernierControle: "2026-04-03" },
    { plaque: "GH-789-IJ", dernierControle: "" },
  ]);
  assert.equal(D.dateInText("le 3/4/26"), "2026-04-03");
});

test("recentWindowStart keeps the current month and the two before", () => {
  assert.equal(D.recentWindowStart("2026-11-18"), "2026-09-01");
  assert.equal(D.recentWindowStart("2026-01-05"), "2025-11-01");
  assert.equal(D.recentWindowStart("2026-03-31"), "2026-01-01");
  assert.equal(D.nextMonthStart("2026-12-15"), "2027-01-01");
  assert.equal(D.monthStart("2026-02-28"), "2026-02-01");
});

test("olderPart only asks for what lies before the loaded window", () => {
  assert.equal(D.olderPart("2026-09-01", "2026-10-01", "2026-09-01"), null);
  assert.equal(D.olderPart("2026-10-12", null, "2026-09-01"), null);
  assert.deepEqual(D.olderPart("2026-08-01", "2026-09-01", "2026-09-01"), { from: "2026-08-01", to: "2026-09-01" });
  assert.deepEqual(D.olderPart("2026-08-20", "2026-09-10", "2026-09-01"), { from: "2026-08-20", to: "2026-09-01" });
  assert.deepEqual(D.olderPart(D.OLDEST_DAY, null, "2026-09-01"), { from: D.OLDEST_DAY, to: "2026-09-01" });
});

test("mergeSlices keeps one copy per request, the most recently changed", () => {
  const rows = D.mergeSlices([
    [{ id: "a", statut: "envoyee", updatedAt: "2026-11-01T10:00" }, { id: "b", statut: "realisee" }],
    [{ id: "a", statut: "realisee", updatedAt: "2026-11-02T10:00" }],
    [{ id: "a", statut: "confirmee", updatedAt: "2026-10-30T10:00" }, { id: "c" }],
  ]);
  assert.deepEqual(rows.map((r) => r.id).sort(), ["a", "b", "c"]);
  assert.equal(rows.find((r) => r.id === "a").statut, "realisee");
});

test("problème sur un véhicule: the report carries the request, the plate and who saw it", () => {
  const d = { id: "d1", plaque: "AB-123-CD", prestataireId: "allo" };
  const r = D.problemReport(d, { type: "pneu", texte: "  pneu avant gauche lisse " }, "allo@x.fr", "2026-11-18T10:00:00.000Z");
  assert.deepEqual(r, { demandeId: "d1", plaque: "AB-123-CD", prestataireId: "allo", type: "pneu", texte: "pneu avant gauche lisse", statut: "nouveau", at: "2026-11-18T10:00:00.000Z", par: "allo@x.fr" });
  assert.equal(D.problemReport(d, { type: "pneu", photo: "k1" }, "a", "t").photo, "k1");
  assert.match(D.problemReport(d, { texte: "rayure" }, "a", "t").error, /type/);
  assert.match(D.problemReport(d, { type: "autre", texte: " " }, "a", "t").error, /quelques mots/);
  assert.equal(D.problemReport(d, { type: "choc", texte: "x".repeat(900) }, "a", "t").texte.length, D.PROBLEM_TEXT_MAX);
  assert.equal(D.problemSummary({ type: "voyant", texte: "moteur orange" }), "Voyant allumé – moteur orange");
  assert.equal(D.problemSummary({ type: "choc", texte: "" }), "Choc / carrosserie");
});

test("problème sur un véhicule: open ones first, newest first; handled ones apart", () => {
  const list = [
    { id: "a", demandeId: "d1", plaque: "AB-123-CD", statut: "nouveau", at: "2026-11-17T08:00" },
    { id: "b", demandeId: "d2", plaque: "ab123cd", statut: "traite", at: "2026-11-16T08:00" },
    { id: "c", demandeId: "d1", plaque: "EF-456-GH", statut: "nouveau", at: "2026-11-18T08:00" },
  ];
  assert.deepEqual(D.openProblems(list).map((s) => s.id), ["c", "a"]);
  assert.deepEqual(D.handledProblems(list).map((s) => s.id), ["b"]);
  assert.deepEqual(D.problemsOfRequest(list, "d1").map((s) => s.id), ["c", "a"]);
  assert.deepEqual(D.problemsOfPlate(list, "AB 123 CD").map((s) => s.id), ["a", "b"]);
});

test("historique : seuls les champs vraiment changés sont notés, avec des libellés lisibles", () => {
  const before = { statut: "envoyee", prixHT: 300, date: "2026-11-20", notes: undefined };
  const changes = D.changesBetween(before, { statut: "realisee", prixHT: 320, date: "2026-11-20", notes: "" });
  assert.deepEqual(changes, [{ champ: "statut", avant: "envoyee", apres: "realisee" }, { champ: "prixHT", avant: 300, apres: 320 }]);
  const [line] = D.historyLines([{ action: "modification", par: "fabian@city-drop.com", at: "2026-11-18T09:05:00", changes }], null);
  assert.equal(line.when, "18/11/2026 à 09h05");
  assert.deepEqual(line.changes.map((c) => `${c.label}: ${c.avant} > ${c.apres}`), ["Statut: Envoyée > Réalisée", "Prix HT: 300 € HT > 320 € HT"]);
});

test("historique : une demande d'avant le suivi garde une ligne de création", () => {
  const lines = D.historyLines([{ action: "reponse", par: "contact@allo-pb.fr", at: { seconds: 1795000000 }, changes: D.answerChanges({ etat: "fait", note: "RAS" }) }],
    { createdAt: "2026-11-01T10:00:00Z", source: "mail" });
  assert.deepEqual(lines.map((l) => l.action), ["Réponse du prestataire", "Création"]);
  assert.equal(lines[0].changes[0].apres, "Fait");
  assert.equal(lines[1].who, "mail City-Drop");
});

test("the team app notices when the mail robot stops, errs or stops receiving mails", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  const ago = (minutes) => new Date(now - minutes * 60000).toISOString();
  assert.equal(D.robotHealth(null, now).level, "off");
  assert.equal(D.robotHealth({ passage: ago(20), dernierMail: ago(60), erreur: "" }, now).level, "ok");
  const stopped = D.robotHealth({ passage: ago(3 * 60), dernierMail: ago(4 * 60), erreur: "" }, now);
  assert.equal(stopped.level, "alert");
  assert.match(stopped.text, /ne tourne plus depuis le 18\/11\/2026/);
  const failing = D.robotHealth({ passage: ago(10), erreur: "connexion refusée", erreurDepuis: ago(50) }, now);
  assert.equal(failing.level, "alert");
  assert.match(failing.text, /connexion refusée/);
  assert.equal(D.robotHealth({ passage: ago(10), dernierMail: ago(5 * 24 * 60), erreur: "" }, now).level, "warn");
  assert.equal(D.robotHealth({ passage: ago(10), dernierMail: ago(3 * 24 * 60), erreur: "" }, now).level, "ok");
  const unread = D.robotHealth({ passage: ago(10), dernierMail: ago(30), nonCompris: "Prise de rendez-vous XX", nonComprisLe: ago(30) }, now);
  assert.equal(unread.level, "warn");
  assert.match(unread.text, /saisis-la à la main/);
  assert.equal(D.robotHealth({ passage: ago(10), dernierMail: ago(30), nonCompris: "Prise de rendez-vous XX", nonComprisLe: ago(4 * 24 * 60) }, now).level, "ok");
});
