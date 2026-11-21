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
