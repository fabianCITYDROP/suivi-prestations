# Sauvegarde automatique, chaque semaine

Une demande supprimée dans Suivi prestations l'est pour de bon, et Firebase gratuit n'en garde aucune copie.
Ce petit script (Google Apps Script, gratuit) fait donc une copie de **toute** la base chaque lundi vers 6 h
et la range dans ton Google Drive, dossier **« Sauvegardes Suivi prestations »** :

- **Sauvegarde AAAA-MM-JJ** : un Google Sheet lisible, un onglet par collection (demandes, prestataires, comptes, réglages…),
  une ligne par document. Les photos n'y sont pas (trop lourdes pour un tableau).
- **Sauvegarde AAAA-MM-JJ.json** : la copie exacte, photos comprises. C'est elle qui sert à remettre une demande.

Les 12 dernières semaines sont gardées ; les plus anciennes vont dans la corbeille de Drive.

## Sécurité (les « 7 portes »)

- Aucun mot de passe, aucune clé dans le script : il lit la base avec **ton** compte Google, celui qui possède le projet Firebase.
- Il ne fait que lire. Seule la fonction `restaurer`, que tu lances toi-même, écrit un document, et elle refuse d'écraser un document qui existe.
- Les fichiers restent privés dans ton Drive. Ne les partage pas : ils contiennent les comptes et les prix.
- Les règles Firestore ne changent pas et personne d'autre n'a un accès en plus.

## Mise en place (une seule fois, 5 minutes)

1. Connecté au compte Google **propriétaire du projet Firebase** « suivi-prestations », ouvrir https://script.new.
2. Renommer le projet « Sauvegarde Suivi prestations ». Coller le contenu de `sauvegarde.js` à la place du code, enregistrer (💾).
3. ⚙️ Paramètres du projet : cocher **« Afficher le fichier manifeste appsscript.json »**.
   Revenir à l'éditeur, ouvrir `appsscript.json` et remplacer tout son contenu par celui de `appsscript-sauvegarde.json`. Enregistrer.
4. En haut, choisir la fonction **`installer`** puis ▶ **Exécuter**, et accepter les autorisations Google
   (si Google affiche « Application non validée » : Paramètres avancés › Accéder au projet).
5. Le journal affiche « Sauvegarde faite : N documents » et le lien du Sheet. Le dossier apparaît dans ton Drive.

Ensuite, plus rien à faire : la copie se refait seule chaque lundi.
Si une semaine échoue, Google t'envoie un e-mail « Summary of failures for Google Apps Script ».

## Remettre une demande supprimée par erreur

1. Ouvrir la dernière **Sauvegarde AAAA-MM-JJ** (Sheet), onglet `demandes`, trouver la ligne et copier son **id** (1re colonne).
2. Dans le script, en bas : `const A_RESTAURER = { collection: 'demandes', id: 'COLLER-L-ID-ICI' };`, enregistrer.
3. Choisir la fonction **`restaurer`** › ▶ Exécuter. La demande revient telle qu'elle était le jour de la sauvegarde.

(Ce qui a été créé ou modifié après la dernière sauvegarde n'est pas dans la copie.)

## Si ça ne marche pas

- **Firestore 403 / PERMISSION_DENIED** : le compte Google utilisé n'est pas propriétaire du projet Firebase.
  Ouvrir le script avec le bon compte, ou console Firebase › ⚙️ › Utilisateurs et autorisations : ajouter ce compte comme Propriétaire.
- Les tests : `node --test apps-script/sauvegarde.test.js`.
