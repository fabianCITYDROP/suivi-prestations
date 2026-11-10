# Import automatique des mails « Prise de rendez-vous »

Chaque fois que City-Drop envoie à un garage le mail automatique « Prise de rendez-vous <plaque> »,
la demande apparaît toute seule dans Suivi prestations (statut « Envoyée »).

## Comment ça marche

1. Une boîte Gmail reçoit ces mails (elle est abonnée au groupe gestion-flotte@city-drop.com).
2. Toutes les 5 minutes, `import-mails.js` (Google Apps Script, gratuit) lit les nouveaux mails :
   il vérifie qu'ils viennent bien de gestion-flotte@city-drop.com **et** qu'ils sont signés city-drop.com (DKIM),
   puis lit plaque, créneau, kilométrage, interventions et nom du garage.
3. Il crée la demande avec un compte « robot » qui ne peut **que** créer ce type de demande : il ne lit rien,
   ne modifie rien, ne choisit ni prestataire ni prix (règles Firestore, testées).
4. Dès qu'un membre de l'équipe ouvre l'appli, celle-ci complète la demande : prestataire (d'après le nom du garage),
   modèle connu pour la plaque, site de la dernière demande de cette plaque, prix HT. Le prestataire la voit alors dans son écran.

Un même mail n'est jamais importé deux fois (l'identifiant de la demande vient du mail).

## Mise en place (une seule fois)

1. **Compte robot** : console Firebase › Authentication › Ajouter un utilisateur
   (ex. `robot-mails@city-drop.com`, mot de passe long). Puis dans l'appli › Réglages › Comptes :
   ajouter cet e-mail avec le rôle « Robot des mails ».
2. **Règles** : console Firebase › Firestore › Règles : coller `src/firestore.rules`, Publier.
3. **Boîte mail** : abonner la boîte Gmail dédiée au groupe gestion-flotte@city-drop.com.
4. **Script** : connecté à cette boîte, ouvrir https://script.new, coller `import-mails.js`, enregistrer.
   ⚙️ Paramètres du projet › Propriétés du script : ajouter `ROBOT_EMAIL` et `ROBOT_MOT_DE_PASSE`.
5. Choisir la fonction `installer` puis ▶ Exécuter, accepter les autorisations Google.
   Le journal affiche « Ajoutée : <plaque> » pour chaque mail des 3 derniers jours.

## Si un mail n'est pas compris

Il est noté « Mail non compris » dans le journal (Apps Script › Exécutions) et doit être saisi à la main.
Les tests `node --test apps-script/import-mails.test.js` vérifient la lecture d'un vrai mail.
