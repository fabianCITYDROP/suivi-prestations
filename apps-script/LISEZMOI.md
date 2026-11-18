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

Une demande venue d'un mail porte un identifiant fait de la plaque et du début du créneau (ex. `mail-GS487PR-20261112-1830`).
Ainsi :
- un même rendez-vous n'est jamais importé deux fois ;
- le mail « Annulation de rendez-vous » passe la demande correspondante en « Annulée » (elle disparaît chez le prestataire) ;
- un nouveau rendez-vous sur le même créneau après une annulation la remet en « Envoyée » ; sur un autre créneau, c'est une nouvelle demande.

Le robot ne peut annuler ou replanifier **que** des demandes venues d'un mail : celles saisies dans l'appli restent intouchables.
Le prestataire est retrouvé d'après les mots du nom du garage (« Du sol au toit 78&92 » → « DSAT (du sol au toit) ») ;
si aucun ne correspond, la demande reste sans prestataire et l'équipe le choisit à la main.

## Mise en place (une seule fois)

1. **Compte robot** : console Firebase › Authentication › Ajouter un utilisateur
   (ex. `robot-mails@city-drop.com`, mot de passe long). Puis dans l'appli › Réglages › Comptes :
   ajouter cet e-mail avec le rôle « Robot des mails ».
2. **Règles** : console Firebase › Firestore › Règles : coller `src/firestore.rules`, Publier.
3. **Boîte mail** : abonner la boîte Gmail dédiée au groupe gestion-flotte@city-drop.com.
4. **Script** : connecté à cette boîte, ouvrir https://script.new, coller `import-mails.js`, enregistrer.
   ⚙️ Paramètres du projet › Propriétés du script : ajouter `ROBOT_EMAIL`, `ROBOT_MOT_DE_PASSE`
   et `ALERTE_EMAIL` (l'adresse qui reçoit les alertes, plusieurs possibles séparées par des virgules).
5. Choisir la fonction `installer` puis ▶ Exécuter, accepter les autorisations Google.
   Le journal affiche « Ajoutée : <plaque> » pour chaque mail des 3 derniers jours.

## Si le robot s'arrête

Un robot arrêté ne se voit pas : les demandes manqueraient en silence dans le bilan. Trois filets :

1. **Bandeau rouge dans l'appli** (équipe) : le robot laisse une trace (`robot/etat`) au moins toutes les 30 minutes.
   Si elle a plus de 2 heures, ou si le robot signale une erreur, l'appli affiche « Le robot des mails ne tourne plus… ».
   Ça marche même si Google a complètement bloqué le script, puisque c'est l'appli qui s'en aperçoit.
   Bandeau orange si aucun mail City-Drop n'est arrivé depuis 4 jours (la boîte n'est peut-être plus abonnée au groupe)
   ou si un mail n'a pas pu être lu. Réglages › Robot des mails montre toujours le dernier passage.
2. **Mail d'alerte** à `ALERTE_EMAIL` quand le robot voit lui-même le problème (mot de passe refusé, règles non publiées…) :
   au début de la panne, puis toutes les 6 heures au plus, et un mail « reparti » quand c'est réglé.
3. **Rattrapage** : une fois réparé, le robot reprend les mails des 3 derniers jours, rien n'est perdu si on agit vite.

Pour réparer : Apps Script › Exécutions montre l'erreur. Le plus souvent, remettre le bon `ROBOT_MOT_DE_PASSE`
dans les Propriétés du script, puis exécuter `installer`.

## Si un mail n'est pas compris

Il est noté « Mail non compris » dans le journal (Apps Script › Exécutions), un mail part à `ALERTE_EMAIL`
et un bandeau orange s'affiche dans l'appli : la demande doit être saisie à la main.
Les tests `node --test apps-script/import-mails.test.js` vérifient la lecture d'un vrai mail.
