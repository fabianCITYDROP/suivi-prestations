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
  assert.deepEqual(csv, { GM149EA: ["MOV - 12", "12M3", ""], HK382ML: ["MOV - 17", "17M3", ""] });
  assert.deepEqual(F.completerAvecCsv({ HK382ML: ["MOV - 12", "12M3", "Paris-Centre"], ZZ999ZZ: ["VIVA - 6", "5M3", "Aulnay"] }, csv), {
    HK382ML: ["MOV - 17", "17M3", "Paris-Centre"], ZZ999ZZ: ["VIVA - 6", "5M3", "Aulnay"], GM149EA: ["MOV - 12", "12M3", ""] });
  assert.throws(() => F.vehiculesDuCsv([["a", "b"]]), /colonnes/);
});

test("Matrice (facultative) : lue dans le CSV, gardée dans la flotte, pas perdue un jour sans CSV", () => {
  const T = ["Cd Vehicules - Vehicule → Immatriculation", "Cd Vehicules - Vehicule → Modele", "Cd Vehicules - Vehicule → Categorie", "Cd Vehicules - Vehicule → Matrice"];
  const csv = F.vehiculesDuCsv([T, ["GP-310-FQ", "MOV - 12", "12M3", "Opel Movano 12m3 2023"], ["HN-388-MJ", "DAILY - H", "20HM3", ""]]);
  assert.deepEqual(csv, { GP310FQ: ["MOV - 12", "12M3", "2023"], HN388MJ: ["DAILY - H", "20HM3", ""] });
  const jour1 = F.fusionnerFlotte({}, F.completerAvecCsv({ GP310FQ: ["MOV - 12", "12M3", "Saint-Cloud"] }, csv), "2026-11-25");
  assert.deepEqual(jour1.GP310FQ, ["MOV - 12", "12M3", "Saint-Cloud", "2026-11-25", "2023"]);
  assert.deepEqual(jour1.HN388MJ, ["DAILY - H", "20HM3", "", "2026-11-25"]);
  const jour2 = F.fusionnerFlotte(jour1, { GP310FQ: ["MOV - 12", "12M3", "La Def"] }, "2026-11-26"); // feuille seule
  assert.deepEqual(jour2.GP310FQ, ["MOV - 12", "12M3", "La Def", "2026-11-26", "2023"]);
});

test("Année : colonne « 1ere Mec » de Metabase (date de 1re mise en circulation)", () => {
  const T = ["Cd Vehicules - Vehicule → Immatriculation", "Cd Vehicules - Vehicule → Modele", "Cd Vehicules - Vehicule → Categorie", "Cd Vehicules - Vehicule → 1ere Mec"];
  assert.deepEqual(F.vehiculesDuCsv([T, ["HK-382-ML", "MOV - 12", "12M3", "28/04/2026"], ["AA-001-AA", "MOV - 20", "20M3", ""]]),
    { HK382ML: ["MOV - 12", "12M3", "2026"], AA001AA: ["MOV - 20", "20M3", ""] });
});

test("Année : la matrice entretien (« Movano 2023 ») passe avant la 1re mise en circulation ; son ID est ignoré", () => {
  const T = ["Cd Vehicules - Vehicule → Immatriculation", "Cd Vehicules - Vehicule → Modele", "Cd Vehicules - Vehicule → Categorie",
    "Cd Vehicules - Vehicule → Matrice ID", "Cd Matrices - Matrice → Nom", "Cd Vehicules - Vehicule → 1ere Mec"];
  assert.deepEqual(F.vehiculesDuCsv([T, ["HK-382-ML", "MOV - 12", "12M3", "27", "Movano 2025", "28/04/2026"],
    ["GP-310-FQ", "MOV - 12", "12M3", "19", "", "31/05/2023"]]),
    { HK382ML: ["MOV - 12", "12M3", "2025"], GP310FQ: ["MOV - 12", "12M3", "2023"] });
});
