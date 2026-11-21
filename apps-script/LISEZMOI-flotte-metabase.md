# Véhicules de l'export Metabase (cubage, modèle, site par plaque)

Chaque matin vers 6 h, le robot lit l'export Metabase déjà rangé par l'appli Runners dans la feuille
« Runners - données » (onglet **Planning**) et met dans l'appli, pour chaque plaque : code modèle, cubage, site.

Ensuite, sans rien saisir :
- une demande reçue par mail prend le modèle, le cubage, le prix (ex. Allo 320 / 360 € HT) et le site ;
- dans « Nouvelle demande », la plaque tapée choisit le modèle et le site (« Metabase : Opel Movano · 12 m³ · Saint-Cloud »).
  Metabase ne donne pas l'année : quand la flotte a deux années pour le même modèle et cubage, on choisit juste la variante.
- Une fiche véhicule où l'équipe a choisi le modèle à la main passe toujours avant Metabase.

Règle de mise à jour : les véhicules du jour sont ajoutés ou mis à jour ; un véhicule absent de l'export garde ses infos
et n'est retiré qu'après 60 jours sans apparaître (l'export ne liste que les VU qui ont une location).
Un export presque vide (moins de 20 véhicules) ne change rien.

Coût Firestore : un seul document (`metabase/flotte`, ~25 Ko) écrit une fois par jour, lu une fois par ouverture de l'appli.
Rien d'autre n'est copié : ni kilométrage, ni client, ni trajet. Les prestataires ne lisent pas ce document.

## Mise en place (une seule fois, dans cet ordre)

1. **Règles** : console Firebase › Firestore › Règles : coller `src/firestore.rules`, **Publier**.
2. **Partage** : connecté au compte des Runners (propriétaire de « Runners - données »), Partager la feuille avec la
   boîte Gmail du robot en **Lecteur** (pas Éditeur), sans notification.
3. **Script** : connecté à la boîte du robot, ouvrir le projet Apps Script « Robot mails ».
   Fichiers › **+** › Script, le nommer `flotte-metabase`, y coller `apps-script/flotte-metabase.js`, Enregistrer.
   Ne touche pas aux autres fichiers.
4. ⚙️ Paramètres du projet › Propriétés du script › Ajouter : `METABASE_FEUILLE` = l'identifiant de la feuille
   (dans son adresse, entre `/d/` et `/edit`).
5. En haut, choisir la fonction `installerFlotte` puis ▶ Exécuter, accepter la nouvelle autorisation Google (lire les feuilles).
   Le journal affiche « Flotte Metabase : N véhicules… ». Pas besoin de nouvelle version de déploiement.

## Si ça s'arrête

Apps Script › Exécutions montre l'erreur de `synchroFlotte` (Google envoie aussi un mail d'échec au propriétaire du script).
Les infos déjà dans l'appli restent : on perd seulement la mise à jour du jour.
