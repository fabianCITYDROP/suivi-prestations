# Suivi prestations CityDrop

Outil de suivi des demandes de pare-brise et de lavage envoyées aux prestataires
(ALLO pare-brise 78…) : saisie, planning du jour par site, photothèque des véhicules,
vérification, bilan du mois.

Page en ligne : https://fabiancitydrop.github.io/suivi-prestations/

- Les données (demandes, véhicules, photos, réglages) sont dans Firebase Firestore.
  L'accès demande le mot de passe de l'équipe (compte Firebase partagé, voir `src/firestore.rules`).
- `src/` contient le code : `domain.js` (règles métier, testées par `node --test src/domain.test.js`),
  `store.js` (accès aux données), `app.js` (interface), `firebase-platform.js` (branchement Firebase).
- Après une modification : `node src/build.js` régénère `index.html`.
- La configuration Firebase est dans `src/firebase-config.js` (valeurs publiques par nature).
