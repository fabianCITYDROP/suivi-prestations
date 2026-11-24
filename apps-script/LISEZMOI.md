# Import automatique des mails « Prise de rendez-vous »

Chaque fois que City-Drop envoie à un garage le mail automatique « Prise de rendez-vous <plaque> »,
la demande apparaît toute seule dans Suivi prestations (statut « Envoyée »).

## Comment ça marche

1. Une boîte Gmail reçoit ces mails (elle est abonnée au groupe gestion-flotte@city-drop.com).
2. Toutes les 5 minutes, `import-mails.js` (Google Apps Script, gratuit) lit les nouveaux mails :
   il vérifie qu'ils viennent bien de gestion-flotte@city-drop.com **et** qu'ils sont signés city-drop.com (DKIM),
   puis lit plaque, créneau, kilométrage, interventions et nom du garage.
3. Il crée la demande avec un compte « robot » qui ne peut **que** créer ce type de demande : il ne choisit jamais de prix
   (règles Firestore, testées). Si le garage du mail est rattaché dans Réglages › Garages des mails (seul réglage
   qu'il peut lire), il pose tout de suite le prestataire et le site, puis lance les alertes : le prestataire est
   prévenu dans les minutes qui suivent, même si personne de l'équipe n'a l'appli ouverte.
4. Dès qu'un membre de l'équipe ouvre l'appli, celle-ci complète la demande : prestataire s'il manque (d'après le nom du garage),
   modèle et cubage connus pour la plaque (fiche véhicule, sinon export Metabase : voir LISEZMOI-flotte-metabase.md),
   adresse et site (garage, sinon Metabase, sinon dernière demande de cette plaque), prix HT.

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

# Alertes appli fermée

Le prestataire est prévenu sur son téléphone dès qu'une demande lui arrive (ou est annulée), et l'équipe dès
qu'un prestataire répond (accepté, fait, autre date, absent, pas possible), **même appli fermée et téléphone verrouillé**.
C'est gratuit : pas de forfait Firebase payant, tout passe par `notifications.js` (Google Apps Script), comme l'appli des runners.

Indépendamment du script : depuis cette version, un « Prestation réalisée » ou une acceptation du prestataire
passe **tout de suite** la demande en « Réalisée » / « Confirmée », même si personne de l'équipe n'a l'appli ouverte.

## Comment ça marche

1. Chaque personne touche une fois « Activer les alertes » (encadré en haut de l'écran prestataire, page Retours pour l'équipe).
   Son téléphone est inscrit dans `abonnements/` avec son rôle et un jeton secret (règles Firestore testées : on n'inscrit
   que ses propres appareils, un prestataire ne reçoit que ce qui concerne son entreprise).
2. Après chaque enregistrement, l'appli dit au script « regarde maintenant » ; le script passe aussi toutes les 5 minutes.
3. Le script lit les demandes modifiées depuis 15 minutes, envoie une alerte **vide** (Apple / Google ne voient rien de lisible),
   et note sur la demande ce qu'il a annoncé (`notifie`) pour ne jamais l'annoncer deux fois. Rien d'antérieur à l'installation n'est annoncé.
4. Le téléphone reçoit l'alerte, demande son texte au script avec son jeton, et l'affiche. Toucher l'alerte ouvre l'appli.

Sur **iPhone**, les alertes ne marchent que si l'appli est ajoutée à l'écran d'accueil (Safari › Partager › « Sur l'écran d'accueil »)
et ouverte depuis son icône : l'encadré le dit au prestataire.

## Mise en place (une seule fois, dans le même projet que l'import des mails)

1. **Règles** : console Firebase › Firestore › Règles : coller `src/firestore.rules`, Publier.
2. **Compte robot** : le même que pour les mails (`ROBOT_EMAIL` / `ROBOT_MOT_DE_PASSE` déjà dans les Propriétés du script).
   S'il n'existe pas encore, suivre les étapes 1 et 4 de l'import des mails ci-dessus.
3. **Script** : dans le projet Apps Script, ➕ Fichier › Script, nommé `notifications`, coller `notifications.js`, enregistrer.
4. Choisir la fonction `installerNotifications` puis ▶ Exécuter, accepter les autorisations Google.
   Le journal affiche « Prêt ».
5. **Déployer › Nouveau déploiement** › type « Application Web » : exécuter en tant que **Moi**, accès **Tout le monde**. Copier l'adresse qui finit par `/exec`.
6. Dans l'appli › Réglages › **Alertes sur les téléphones** : coller l'adresse, Enregistrer.
7. Page Retours : « Activer les alertes ». Une alerte d'essai « Alertes activées » arrive.

« Tout le monde » est nécessaire pour que les téléphones des prestataires joignent le script ; il ne fait que trois choses sans danger
(donner la clé publique, regarder les demandes, rendre le texte d'une alerte à l'appareil qui a le bon jeton) et n'appelle que les vrais
services d'alertes (Apple, Google, Mozilla, Microsoft). La clé privée qui signe les alertes reste dans les Propriétés du script.

## Rappel du matin (8 h)

Chaque matin vers 8 h (heure de Paris), l'équipe reçoit une alerte qui liste ce qui a été oublié :
- les **prestations pas faites** : la date prévue (ou le dernier jour de la période) est passée et la demande n'est ni réalisée, ni annulée, ni marquée « fait » par le prestataire ;
- les **demandes sans réponse depuis 24 h** : envoyées au prestataire il y a plus de 24 h, sans aucune réponse de sa part.

Les demandes de hayon sont ignorées (elles se clôturent toutes seules). L'alerte arrive sur les comptes équipe qui ont activé les alertes.
S'il n'y a rien d'oublié, **aucune alerte n'est envoyée**.

Mise en place (une fois) :
1. Dans le projet Apps Script, remplacer le contenu du fichier `notifications` par le nouveau `notifications.js`, enregistrer.
2. Choisir la fonction `installerRappelDuMatin` puis ▶ Exécuter (accepter les autorisations Google si on les demande).
3. Pour essayer tout de suite : choisir `rappelDuMatin` puis ▶ Exécuter.

Pas de nouveau déploiement à faire, et pas de changement des règles Firestore.

Tests : `node --test apps-script` (signature vérifiée par Node et par le vecteur officiel RFC 6979) ;
`cd tests-regles && npm run alertes` rejoue tout le parcours dans les émulateurs Firebase.
