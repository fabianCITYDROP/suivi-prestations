// node --test apps-script : lecture de l'onglet Planning (export Metabase) et fusion jour après jour.
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("./flotte-metabase.js");

const TITRES = ["plaque", "modele", "categorie", "km", "ville_depart", "date_depart", "heure_depart", "ville_arrivee", "date_arrivee"];
const ligne = (o) => TITRES.map((t) => o[t] ?? "");

test("une plaque = son code modèle, sa catégorie et le site de sa dernière réservation commencée", () => {
  const valeurs = [TITRES,
    ligne({ plaque: "HK-382-ML", modele: "MOV - 12", categorie: "12M3", km: "41281", ville_depart: "Rennes", date_depart: "2026-11-19", ville_arrivee: "Paris-Centre" }),
    ligne({ plaque: "HK-382-ML", modele: "MOV - 12", categorie: "12M3", ville_depart: "Paris-Centre", date_depart: "2026-11-25", ville_arrivee: "Lyon - Dardilly" }),
    ligne({ plaque: "GS-279-RY", modele: "DAILY - H", categorie: "20HM3", ville_depart: "Aulnay", date_depart: "2026-12-02", ville_arrivee: "Nice - Carros" }),
    ligne({ plaque: "GW-670-PH" }), // ligne « impro » sans véhicule : ignorée
  ];
  assert.deepEqual(F.vehiculesDeLExport(valeurs, "2026-11-21"), {
    GS279RY: ["DAILY - H", "20HM3", "Aulnay"],
    HK382ML: ["MOV - 12", "12M3", "Paris-Centre"],
  });
});

test("colonnes manquantes : erreur claire plutôt qu'une flotte vide", () => {
  assert.throws(() => F.vehiculesDeLExport([["plaque", "km"]], "2026-11-21"), /colonnes/);
});

test("ajoute et met à jour, garde un absent 60 jours, puis le retire", () => {
  const ancien = { AB123CD: ["MOV - 12", "12M3", "La Def", "2026-10-01"], EF456GH: ["VIVA - 6", "5M3", "Aulnay", "2026-09-01"], HK382ML: ["MOV - 12", "12M3", "Rennes", "2026-11-20"] };
  const nouveau = { HK382ML: ["MOV - 12", "12M3", "Paris-Centre"], ZZ999ZZ: ["MAX - 20", "20M3", "Toulouse"] };
  assert.deepEqual(F.fusionnerFlotte(ancien, nouveau, "2026-11-21"), {
    AB123CD: ["MOV - 12", "12M3", "La Def", "2026-10-01"],   // absent depuis 51 jours : gardé
    HK382ML: ["MOV - 12", "12M3", "Paris-Centre", "2026-11-21"], // site mis à jour
    ZZ999ZZ: ["MAX - 20", "20M3", "Toulouse", "2026-11-21"],  // nouveau
  });                                                         // EF456GH absent depuis 81 jours : retiré
});

test("CSV du mail Metabase : modèle et catégorie de chaque VU, immobilisés compris ; le site reste celui de la feuille", () => {
  const T = ["﻿Vehicule ID", "Statut", "Cd Vehicules - Vehicule → Immatriculation", "Cd Vehicules - Vehicule → Modele", "Cd Vehicules - Vehicule → Categorie", "Cd Vehicules - Vehicule → Sous Statut"];
  const csv = F.vehiculesDuCsv([T,
    ["404", "IMPRODUCTIF", "GM-149-EA", "MOV - 12", "12M3", "4"],
    ["405", "ROUTE", "HK-382-ML", "MOV - 17", "17M3", "1"],
    ["", "PROVINCE", "", "", "", ""]]);
  assert.deepEqual(csv, { GM149EA: ["MOV - 12", "12M3", "", "P"], HK382ML: ["MOV - 17", "17M3", "", "A"] }); // sous-statut 4 = en panne, 1 = actif
  assert.deepEqual(F.completerAvecCsv({ HK382ML: ["MOV - 12", "12M3", "Paris-Centre"], ZZ999ZZ: ["VIVA - 6", "5M3", "Aulnay"] }, csv), {
    HK382ML: ["MOV - 17", "17M3", "Paris-Centre", "", "", "A"], ZZ999ZZ: ["VIVA - 6", "5M3", "Aulnay"], GM149EA: ["MOV - 12", "12M3", "", "", "", "P"] });
  assert.throws(() => F.vehiculesDuCsv([["a", "b"]]), /colonnes/);
});

test("Matrice ID (facultatif) : lue dans le CSV, gardée dans la flotte, pas perdue un jour sans CSV", () => {
  const T = ["Cd Vehicules - Vehicule → Immatriculation", "Cd Vehicules - Vehicule → Modele", "Cd Vehicules - Vehicule → Categorie", "Cd Vehicules - Vehicule → Matrice ID"];
  const csv = F.vehiculesDuCsv([T, ["GP-310-FQ", "MOV - 12", "12M3", "19"], ["HN-388-MJ", "DAILY - H", "20HM3", ""]]);
  assert.deepEqual(csv, { GP310FQ: ["MOV - 12", "12M3", "19"], HN388MJ: ["DAILY - H", "20HM3", ""] });
  const jour1 = F.fusionnerFlotte({}, F.completerAvecCsv({ GP310FQ: ["MOV - 12", "12M3", "Saint-Cloud"] }, csv), "2026-11-25");
  assert.deepEqual(jour1.GP310FQ, ["MOV - 12", "12M3", "Saint-Cloud", "2026-11-25", "19"]);
  assert.deepEqual(jour1.HN388MJ, ["DAILY - H", "20HM3", "", "2026-11-25"]);
  const jour2 = F.fusionnerFlotte(jour1, { GP310FQ: ["MOV - 12", "12M3", "La Def"] }, "2026-11-26"); // feuille seule
  assert.deepEqual(jour2.GP310FQ, ["MOV - 12", "12M3", "La Def", "2026-11-26", "19"]);
});


test("État du véhicule : actif au planning, en panne, inactif (sorti de la flotte) ; gardé un jour sans CSV", () => {
  const T = ["Vehicule ID", "Statut", "Cd Vehicules - Vehicule → Immatriculation", "Cd Vehicules - Vehicule → Modele", "Cd Vehicules - Vehicule → Categorie",
    "Cd Vehicules - Vehicule → Sous Statut", "Cd Vehicules - Vehicule → Statut"];
  const csv = F.vehiculesDuCsv([T,
    ["1", "ROUTE", "HN-515-TH", "DAILY - H", "20HM3", "1", "false"],
    ["2", "IMPRODUCTIF", "GG-606-MC", "MOV - H", "20HM3", "4", "false"],
    ["3", "IMPRODUCTIF", "GS-241-SC", "M20H-DVL", "20HM3", "4", "true"],
    ["4", "ROUTE", "TE-111-ST", "MOV - 12", "12M3", "5", "false"]]);
  assert.deepEqual(csv, { HN515TH: ["DAILY - H", "20HM3", "", "A"], GG606MC: ["MOV - H", "20HM3", "", "P"], GS241SC: ["M20H-DVL", "20HM3", "", "I"], TE111ST: ["MOV - 12", "12M3", "", "X"] });
  // Sans la colonne « → Statut » : le « Statut » de la réservation n'est pas pris pour celui du véhicule.
  assert.deepEqual(F.vehiculesDuCsv([T.slice(0, 6), ["3", "true", "GS-241-SC", "M20H-DVL", "20HM3", "4"]]).GS241SC, ["M20H-DVL", "20HM3", "", "P"]);
  const jour1 = F.fusionnerFlotte({}, F.completerAvecCsv({ HN515TH: ["DAILY - H", "20HM3", "Rouen"] }, csv), "2026-11-26");
  assert.deepEqual(jour1.HN515TH, ["DAILY - H", "20HM3", "Rouen", "2026-11-26", "", "A"]);
  assert.deepEqual(jour1.GS241SC, ["M20H-DVL", "20HM3", "", "2026-11-26", "", "I"]);
  const jour2 = F.fusionnerFlotte(jour1, { HN515TH: ["DAILY - H", "20HM3", "La Def"] }, "2026-11-27"); // feuille seule
  assert.deepEqual(jour2.HN515TH, ["DAILY - H", "20HM3", "La Def", "2026-11-27", "", "A"]);
});
