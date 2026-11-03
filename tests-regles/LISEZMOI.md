# Tests des accès

Tout tourne dans les émulateurs Firebase, sur l'ordinateur : aucune donnée réelle n'est lue ni modifiée.

- `npm install` puis `npm test` : vérifie les règles `src/firestore.rules` (Khalid ne voit rien d'Allo Pare-Brise, un prestataire ne peut que répondre à ses demandes, Jérôme lit sans modifier, un compte inconnu ne voit rien).
- `npm run parcours` : ouvre la vraie page dans un navigateur et rejoue le parcours de mise en place (tarif, « Préparer les accès », ajout d'un compte prestataire, nouvelle demande au prix figé, connexion de Khalid).

Java est nécessaire pour l'émulateur Firestore.
