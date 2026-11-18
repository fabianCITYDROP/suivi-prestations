# Suivi prestations CityDrop

Outil de suivi des demandes de pare-brise et de lavage envoyées aux prestataires
(ALLO pare-brise 78…) : saisie, planning du jour par site, photothèque des véhicules,
vérification, bilan du mois.

Page en ligne : https://fabiancitydrop.github.io/suivi-prestations/

- Les données (demandes, véhicules, photos, réglages) sont dans Firebase Firestore.
  Chaque membre de l'équipe se connecte avec son compte Firebase (adresse + mot de passe, voir `src/firestore.rules`).
- `src/` contient le code : `domain.js` (règles métier, testées par `node --test src/domain.test.js`),
  `store.js` (accès aux données), `app.js` (interface), `firebase-platform.js` (branchement Firebase).
- Après une modification : `node src/build.js` régénère `index.html`.
- La configuration Firebase est dans `src/firebase-config.js` (valeurs publiques par nature).

## Accès par prestataire (phase 1)

- Chaque personne a un document `comptes/<adresse e-mail>` : `admin` (équipe CityDrop), `prestataire` (avec `prestataireId`) ou `lecture`.
  Un prestataire ne voit que les demandes dont `prestataireId` est le sien. Tout se gère dans Réglages › Accès à l'appli.
- Les tarifs sont en HT par prestataire (Réglages › Tarifs hors taxe) ; le prix est figé sur la demande (`prixHT`).
- `tests-regles/` vérifie les règles et le parcours dans les émulateurs Firebase (voir son LISEZMOI).

## Alertes appli fermée (phase 3)

- `sw.js` reçoit les alertes ; `src/notifs.js` inscrit l'appareil (`abonnements/<id>`) ; `apps-script/notifications.js` les envoie
  (Web Push gratuit, même projet Apps Script que l'import des mails). Adresse du script : `public/notifications`, réglée dans Réglages.
- La réponse « fait » / « accepté » d'un prestataire change le statut de la demande elle-même (`D.answerPatch`), sans attendre l'équipe.
- Mise en place : `apps-script/LISEZMOI.md`, section « Alertes appli fermée ».
