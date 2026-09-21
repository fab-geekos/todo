# Objectifs du mois : Notion → Todo

Deux commandes qui recopient les objectifs mensuels de Notion dans l'app Todo, puis les archivent.
Le fonctionnement complet est décrit dans [SPEC.md](SPEC.md).

## Chaque mois

Toujours dans cet ordre :

1. **`objectifs cloture`** dans les premiers jours du mois : archive le mois écoulé dans Notion, remet « Dans 1 mois » à zéro et retire les objectifs de l'app.
2. Écrire les nouveaux objectifs dans « Dans 1 mois ».
3. **`objectifs import`** : recopie les objectifs dans l'app (aperçu, puis « o » pour valider).

Tout premier lancement, une seule fois : `objectifs import --adoption` (reconnaît les objectifs déjà saisis à la main).

Option `--temps` : affiche la durée de chaque étape (ex. `objectifs import --temps`).

En cas d'erreur, le script s'arrête sans rien casser et dit quoi faire. Après une coupure (réseau, fenêtre fermée), il suffit de relancer la même commande : elle reprend là où elle s'est arrêtée.

## Installation (une seule fois)

1. **Dépendances** : dans ce dossier, lancer `npm install` (Node.js 22 ou plus).
2. **Jeton Notion** :
   - aller sur https://www.notion.so/profile/integrations → « Nouvelle intégration » (type interne), nom « Objectifs Todo » ;
   - capacités : lire, mettre à jour et insérer du contenu ;
   - copier le « jeton d'intégration interne » (commence par `ntn_`) ;
   - dans Notion, ouvrir la page qui contient « Dev perso » → menu ⋯ → **Connexions** → ajouter « Objectifs Todo ».
3. **Clé Firebase** : console Firebase → projet `fabien---todo` → ⚙️ Paramètres du projet → **Comptes de service** → « Générer une nouvelle clé privée ». Enregistrer le fichier dans ce dossier sous le nom `serviceAccountKey.json`.
4. **Configuration** : copier `config.exemple.json` en `config.local.json` et remplir :
   - `notion.token` : le jeton de l'étape 2 ;
   - `notion.page` : le lien de la page Notion (menu ⋯ → Copier le lien) ;
   - `firebase.email` : l'adresse du compte Google utilisé dans l'app.
5. **Commande `objectifs` partout** : Paramètres Windows → rechercher « variables d'environnement » → « Modifier les variables d'environnement pour votre compte » → `Path` → Nouveau → coller le chemin de ce dossier. Rouvrir cmd.

Au premier lancement, le script mémorise l'emplacement des sections Notion et ton identifiant Firebase dans `config.local.cache.json` (revérifiés à chaque lancement). Ce fichier peut être supprimé à tout moment : il sera recréé.

⚠️ `serviceAccountKey.json`, `config.local.json`, `config.local.cache.json` et `sauvegardes/` contiennent des secrets ou des données réelles : ils sont exclus de Git (le dépôt est public). Ne jamais les envoyer à qui que ce soit.

## Pour le développement

- `npm test` : tests complets sur un faux Notion et un faux Firestore (aucun accès réseau).
- `src/regles.js` : toutes les règles (fusion des doublons, priorités, plans d'import et de clôture), sans réseau.
- `src/notion.js` : accès à Notion (bibliothèque officielle, adaptateur mince).
- `src/store.js` : accès à Firestore par son API web, sans bibliothèque (jeton signé avec la clé de service, transactions).
- `src/import.js`, `src/cloture.js` : les deux commandes, étape par étape, avec vérifications.
- `OBJECTIFS_DEBUG=1` affiche le détail technique d'une erreur inattendue.
