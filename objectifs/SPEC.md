# Objectifs du mois : Notion → Todo

Spécification V1. Rédigée le 21/09/2026 à partir du brainstorming.

> ⚠️ Ce fichier est dans le dépôt **public** `fab-geekos/todo`. Tous les exemples d'objectifs sont **fictifs**. Ne jamais y coller de vrais objectifs.

---

## 1. But

Chaque mois, Fabien écrit ses objectifs dans Notion. Deux commandes font le reste :

- **`objectifs cloture`** : dans les premiers jours du mois, recopie dans Notion ce qui a été fait dans l'app, archive le mois écoulé, remet la page à zéro et retire les objectifs de l'app.
- **`objectifs import`** : recopie les nouveaux objectifs de Notion dans l'app Todo (projet perso « Objectifs du mois »), avec les priorités placées dans la matrice d'Eisenhower.

Principes :

- **Notion = le plan.** C'est là que Fabien écrit. Le choix entre objectif « répété » et « reporté » est fait à la main à ce moment-là. C'est la partie qui a de la valeur ; tout le reste est de l'automatisation.
- **L'app = le suivi.** C'est là qu'on coche. On ne coche jamais aux deux endroits.
- **Zéro erreur tolérée.** Au moindre doute, le script s'arrête **avant** d'écrire quoi que ce soit et explique pourquoi.
- **Pas d'IA à l'exécution.** Un script ordinaire, écrit par Claude, lancé par Fabien. Claude ne voit jamais les objectifs réels.

## 2. Périmètre

**Dans la V1 :** uniquement la section « Dans 1 mois », uniquement l'espace **perso** de l'app.

**Hors V1 :** les horizons « Dans 3 mois / 1 an / 5 ans / 10 ans » (on y réfléchira plus tard), l'espace pro.

## 3. Le déroulé chaque mois

> **Toujours dans cet ordre : CLÔTURE d'abord, puis écriture, puis IMPORT.**

Exemple pour le passage de septembre à octobre 2026 (objectifs de septembre datés `@01/10/2026`) :

| # | Quand | Qui / quoi | Résultat |
|---|---|---|---|
| 1 | Fin septembre | **Fabien, dans l'app** : vérifie que tout ce qui est fait est bien coché. | Le suivi est à jour. |
| 2 | Premiers jours d'octobre | **`objectifs cloture`** | Septembre est archivé dans Notion sous `@01/10/2026`, avec les cases cochées et le score. « Dans 1 mois » redevient un modèle vierge daté `@01/11/2026`. Les objectifs de septembre sont retirés de l'app. |
| 3 | Juste après | **Fabien, dans Notion** : écrit les objectifs d'octobre dans le modèle vierge (répétés, reportés, nouveaux). | Le plan d'octobre est prêt. |
| 4 | Dès que l'écriture est finie | **`objectifs import`** | Les objectifs d'octobre sont dans l'app, le score `/N :` est écrit dans Notion. |
| 5 | Tout le mois | **Fabien, dans l'app** : coche, organise, ajoute des tâches manuelles au besoin. | |

Garde-fous qui protègent cet ordre (détails § 6 et 7) :

- `import` **refuse** de tourner tant que les objectifs du mois précédent sont encore dans l'app (clôture oubliée).
- `cloture` **refuse** de tourner si une case de Notion n'a jamais été importée.
- Les deux commandes peuvent être **relancées sans risque** (après une erreur, une coupure réseau, ou un objectif ajouté après coup).

**Tout premier lancement (une seule fois)** : les objectifs de septembre sont déjà dans l'app, saisis à la main. Avant la première clôture, lancer `objectifs import --adoption` (§ 7.1) pour que le script les reconnaisse. Ensuite, le cycle normal ci-dessus s'applique.

## 4. La page Notion (source)

### 4.1 Structure

```
Dev perso
└─ Objectifs
   ├─ Dans 10 ans / Dans 5 ans / Dans 1 an / Dans 3 mois     (non touchés)
   ├─ Dans 1 mois                                           ← clôturé par cloture, lu par import
   │   ├─ @01/10/2026                    date de revue (mention Notion)
   │   ├─ / :                            ligne de score
   │   ├─ Top priorités                  titre en gras (catégorie)
   │   │   ☐ Finir le dossier A P1
   │   │   ☐ Préparer le budget P2
   │   │   ☐ Lire le livre B P3
   │   ├─ Culture                        titre en gras (catégorie)
   │   │   ☐ Lire le livre B                        (même texte que dans Top priorités)
   │   │   ☐ Voir l'exposition C @15/09/2026         (échéance)
   │   ├─ Projets perso
   │   │   ☐ Avancer le projet D
   │   │       ☐ Étape 1                             (sous-objectif = case indentée)
   │   │       ☐ Étape 2
   │   └─ …
   └─ Archives
       └─ Dans 1 mois
           ├─ @01/04/2025 … @01/09/2026              ← une archive par mois
           └─ @01/10/2026                            ← créée par cloture
```

### 4.2 Règles de lecture

| Élément Notion | Traitement |
|---|---|
| **Mention de date en tête** | Date de revue du mois (toujours le 1er d'un mois). Le script lit la vraie date, pas l'affichage « jeudi prochain ». Elle sert d'étiquette au mois et de titre à l'archive, toujours au format `@01/MM/AAAA`. **Absente ou pas un 1er du mois → arrêt.** |
| **Ligne « / : »** | Ligne de score, remplie par le script : `/9 :` après l'import, `6/9 :` après la clôture. Tout texte après les « : » est laissé intact. |
| **Texte en gras sans case** (catégories, « Top priorités ») | Ignoré à l'import. Conservé tel quel dans l'archive et dans le modèle vierge. |
| **Case à cocher** | Un objectif = une tâche dans l'app. |
| **Case indentée sous une case** | Un sous-objectif = une sous-tâche. L'app accepte 3 niveaux au maximum ; **au-delà → arrêt**. |
| **`P1` / `P2` / `P3` en fin de ligne** | Priorité (§ 5.1). Retiré du titre dans l'app, conservé dans l'archive. |
| **Pas de P écrit** | P4. |
| **Mention @date dans une ligne** | Échéance de la tâche. Retirée du titre dans l'app, conservée dans l'archive. Seules les mentions Notion comptent : « en novembre » ou « x2/semaine » restent du texte, sans échéance ni récurrence. |
| **Case vide avec des sous-cases** | La case vide est ignorée ; ses sous-cases deviennent des tâches normales (P4). Dans l'archive, la case vide disparaît et ses sous-cases remontent d'un niveau. |
| **Case vide sans sous-case** | Ignorée. Ne compte pas dans le score. Absente de l'archive. |
| **Deux cases au texte identique** (ex. Top priorités + catégorie) | **Une seule tâche** dans l'app, avec la priorité trouvée ; un seul point dans le score ; les deux cases cochées ensemble à la clôture. Comparaison du texte sans tenir compte de la casse, des espaces en trop ni du Px. |
| **Deux cases qui se ressemblent sans être identiques** | Signalées dans l'aperçu (risque de doublon involontaire), sans bloquer. |

**Score** : une case = une unité (objectif ou sous-objectif). Les doublons comptent une fois, les cases vides ne comptent pas.

## 5. Ce qui est écrit dans l'app

### 5.1 Priorités

Dans l'app, la priorité d'une tâche est définie par deux indicateurs : « important » et « urgent ».

| Notion | Important | Urgent | Case de la matrice (perso) |
|---|---|---|---|
| P1 | oui | oui | Faire |
| P2 | oui | non | Planifier |
| P3 | non | oui | Si possible |
| P4 | non | non | Sans priorité |

- La vue Eisenhower **générale** n'affiche pas « Sans priorité » : les P4 n'y apparaissent pas.
- La matrice **du projet** « Objectifs du mois » affiche les 4 cases. C'est voulu : les deux vues n'ont pas le même rôle.
- La priorité se met **uniquement sur l'objectif racine**. Les sous-objectifs n'en ont pas.

### 5.2 Une tâche importée

- Projet : « Objectifs du mois » (espace perso). **Projet introuvable ou présent en double → arrêt.**
- Titre : texte Notion, sans le `Px` et sans la mention de date.
- Échéance : la mention @date si elle existe, sinon aucune.
- Hiérarchie : identique à Notion.
- **Étiquette invisible** : champ `notion` contenant l'identifiant du ou des blocs Notion et le mois (ex. `2026-10-01`). Elle permet de :
  - reconnaître les tâches importées (les tâches ajoutées à la main ne sont **jamais** touchées) ;
  - relancer l'import sans créer de doublons ;
  - retrouver la tâche à la clôture même si elle a été renommée ou déplacée ;
  - garder les deux identifiants quand deux cases ont été fusionnées.

Comportements de l'app déjà en place :

- Le parent ne se coche **pas** automatiquement quand ses sous-tâches sont faites.
- **La purge des tâches terminées** (automatique après 90 jours, ou bouton 🧹 du menu ⋯) **épargne les tâches importées** : c'est la clôture qui les retire.

## 6. Commande `objectifs cloture` (étape 1 du déroulé)

Seul cas particulier : si on la lance **avant** la date de revue (ex. le 25/09 pour `@01/10/2026`), le script demande une confirmation (« La date de revue est le 01/10/2026. Clôturer quand même ? o/n »). Ça évite une clôture anticipée par erreur.

1. **Lecture** de Notion et des tâches importées dans l'app.
2. **Contrôles :**
   - une case Notion jamais importée → arrêt : « Lance `objectifs import`, ou supprime la case dans Notion, puis relance » ;
   - des tâches importées appartiennent à un autre mois → arrêt.
3. **Sauvegarde** (§ 9).
4. **Report du suivi** (dans la copie d'archive) :
   - tâche cochée dans l'app → case cochée (les deux cases si elles ont été fusionnées) ;
   - tâche non cochée → case non cochée ;
   - tâche **supprimée dans l'app** en cours de mois → la case **disparaît** de l'archive (avec ses sous-cases si c'est le parent qui a été supprimé).
5. **Score :** `/N :` devient `X/N :`, recalculé à la clôture (X = cases faites, N = cases restantes après suppressions).
6. **Archive :** création de `@01/10/2026` à la fin de Archives › Dans 1 mois, contenant la copie **fidèle** de « Dans 1 mois » (texte Notion d'origine, catégories, couleurs des P, mentions de dates), avec les cases cochées et le score.
7. **Vérification de l'archive** : relecture et comparaison des comptes. **Écart → arrêt, rien n'est effacé.**
8. **Modèle vierge** dans « Dans 1 mois » :
   - date avancée d'un mois (`@01/11/2026`) ;
   - `/ :` remis à zéro ;
   - catégories en gras conservées (y compris « Top priorités ») ;
   - toutes les cases retirées (elles vont dans la corbeille Notion, récupérables 30 jours).
9. **Suppression dans l'app** des tâches importées de ce mois, et uniquement celles-là.
10. **Vérification finale** puis **bilan** à l'écran : « 6/9 atteints. Non faits : … ». Ce bilan aide à écrire le mois suivant.

**Reprise après interruption** (coupure réseau, fermeture) : on relance simplement la commande. Le script détecte où il s'était arrêté (ex. archive `@01/10/2026` déjà créée et conforme → il passe à l'étape 8) et ne refait jamais une étape déjà faite.

## 7. Commande `objectifs import` (étape 3 du déroulé)

À lancer **après la clôture**, une fois les objectifs du nouveau mois écrits dans Notion.

1. **Lecture** de « Dans 1 mois » dans Notion et vérification de la structure (§ 4.2).
2. **Garde-fou : clôture oubliée.** Si l'app contient encore des tâches importées d'un **autre** mois → arrêt : « Lance d'abord `objectifs cloture` ».
3. **Garde-fou : relance.** Les cases déjà importées pour ce mois sont reconnues et sautées. Seules les nouvelles sont ajoutées.
4. **Sauvegarde** (§ 9).
5. **Aperçu** à l'écran : objectifs, sous-objectifs, priorités, échéances, doublons fusionnés, ressemblances suspectes, score prévu. **Rien n'est écrit sans un « o » de Fabien.**
6. **Écriture dans l'app**, en une seule opération (tout ou rien).
7. **Écriture du score** dans Notion : `/ :` devient `/N :`.
8. **Vérification** : relecture de l'app et de Notion ; les comptes doivent correspondre exactement. Sinon, message d'erreur (§ 8).

### 7.1 Premier lancement : mode adoption (une seule fois)

`objectifs import --adoption`, à lancer **avant la première clôture** (donc avant le 01/10/2026), car le projet contient déjà les objectifs de septembre saisis à la main.

- Une tâche du projet dont le texte correspond à une case Notion est **adoptée** : on lui ajoute l'étiquette, et elle garde son statut et ses sous-tâches.
- Une case Notion sans équivalent est créée.
- Une tâche du projet sans équivalent dans Notion est **listée**, et le script s'arrête. Fabien la renomme pour qu'elle corresponde, ou confirme qu'elle doit être ignorée (elle restera alors une tâche manuelle, jamais touchée).

## 8. Erreurs

Dans tous les cas : **arrêt avant toute écriture** (ou, pendant la clôture, avant toute suppression), et message en français qui dit **quoi**, **où** (texte de la ligne concernée) et **quoi faire**. Exemple :

> ❌ La case « Avancer le projet D » est dans Notion mais introuvable dans l'app.
> → Elle a peut-être été ajoutée après l'import. Lance `objectifs import`, ou supprime la case dans Notion, puis relance `objectifs cloture`.

| Cas | Commande |
|---|---|
| Date de revue absente ou pas un 1er du mois | cloture, import |
| Section « Dans 1 mois » ou « Archives › Dans 1 mois » introuvable (renommée ?) | cloture, import |
| Tâches importées d'un autre mois encore présentes | cloture, import |
| Case jamais importée au moment de la clôture | cloture |
| Archive du mois déjà présente mais différente de l'attendu | cloture |
| Plus de 3 niveaux de cases | import |
| Projet « Objectifs du mois » introuvable ou en double | import |
| Comptes différents après écriture | cloture, import |
| Clé Notion ou Firebase absente, invalide, ou page non partagée | cloture, import |
| Écriture refusée par l'app (conflit de synchronisation, réseau) | cloture, import |

Une tâche orpheline (sous-objectif dont l'objectif parent n'a pas été créé) n'est pas une erreur bloquante : elle devient une tâche normale, et l'aperçu la signale.

## 9. Sauvegardes

Avant toute écriture, le script enregistre dans `objectifs/sauvegardes/` :

- l'espace perso complet de l'app (même format que l'export JSON de l'app, réimportable par son menu ⋯) ;
- le contenu de « Dans 1 mois » dans Notion.

**Seules les 2 dernières sauvegardes sont gardées** ; les plus anciennes sont effacées automatiquement. Rien n'est stocké dans l'app elle-même. Ce dossier est exclu de Git (il contient des données réelles).

## 10. Lancement

Depuis cmd :

```
objectifs cloture
objectifs import
objectifs import --adoption      (une seule fois, au tout premier lancement)
```

- Installation : Node.js + le dossier `Todo/objectifs/`. Ajout de ce dossier au PATH Windows (réglage fait par Fabien, marche à suivre fournie) pour lancer la commande depuis n'importe où.
- Les commandes sont **lancées par Fabien**. Claude ne les lance pas sur les vraies données.

## 11. Clés et confidentialité

- **Notion** : une « intégration interne » (gratuite), partagée avec la page qui contient les objectifs. Qu'elle voie aussi le reste de cette page est accepté.
- **Firebase** : clé de service du projet `fabien---todo`.
- Les deux clés restent **sur le PC**, dans `objectifs/config.local.json`, exclu de Git. Jamais publiées.

## 12. Emplacement et versionnage

- Le script vit dans le sous-dossier **`objectifs/`** du projet Todo : c'est une partie de l'app Todo.
- Il est versionné dans le dépôt `fab-geekos/todo`, qui est **public** et publié par GitHub Pages. Conséquences :
  - le code et cette spec sont visibles publiquement (sans risque : aucun secret, exemples fictifs) ;
  - `objectifs/sauvegardes/` et `objectifs/config.local.json` sont exclus par `.gitignore` (déjà en place).

## 13. Développement

- Node.js, bibliothèque officielle `@notionhq/client` (Notion). Firestore est appelé directement par son API web (HTTPS, jeton signé avec la clé de service), sans bibliothèque : voir § 15.
- Claude développe et teste dans un **bac à sable** : une page Notion de test (copie de la structure avec de faux objectifs) et un espace de test dans Firestore (ni perso ni pro). Les vraies données ne sont jamais utilisées pendant le développement.
- Fabien lance ensuite directement sur ses vraies données (premier lancement : `import --adoption`).

## 14. Déjà fait dans l'app

| Changement | Commit |
|---|---|
| Case P3 affichée « Si possible » en perso (pro : « Déléguer ») | `30223c9` |
| Case P4 affichée « Sans priorité » en perso (pro : « Éliminer ») | `2d65602` |
| La purge des tâches terminées épargne les tâches importées de Notion | `2d65602` |

## 15. Précisions apparues au codage (V1)

Petits choix faits pendant l'implémentation, dans l'esprit de la spec. À rediscuter si l'un d'eux ne convient pas.

| Sujet | Choix retenu | Pourquoi |
|---|---|---|
| Confirmation de la clôture | La clôture affiche son résumé (score, non faits, ce qui va se passer) et attend un « o », comme l'import. | Elle supprime des cases et des tâches : rien ne part sans accord. |
| Moment de la sauvegarde | Faite juste **après** le « o », avant la première écriture. | Répondre « n » ne fait pas tourner les sauvegardes pour rien. |
| Registre des cases importées | Un petit document Firestore à part (`users/{uid}/objectifs/perso` : mois + identifiants des cases), que l'app ignore. | Distinguer « supprimée dans l'app » (retirée de l'archive) de « jamais importée » (arrêt). Vidé à chaque clôture. |
| Sous-objectif au même texte qu'un objectif | Fusionné avec l'objectif (une tâche, avec sa priorité), signalé dans l'aperçu. | Cas « mis en avant dans Top priorités ». |
| Sous-tâches ajoutées à la main sous un objectif importé | Retirées avec l'objectif à la clôture, listées dans le résumé avant le « o ». | Elles font partie de l'objectif archivé. |
| Contenu de l'archive | Copie de toute la section, y compris la ligne de date et la ligne de score (remplie), sauf les cases vides (retirées, leurs sous-cases remontées d'un niveau). | Copie fidèle, sans les cases oubliées. |
| Clé Firebase | Fichier `objectifs/serviceAccountKey.json` (chemin indiqué dans `config.local.json`), exclu de Git. | Format fourni par Firebase. |
| Rapidité | Lectures Notion en parallèle (3 requêtes à la fois au plus), connexion à Firebase pendant la lecture de Notion, emplacement des sections et identifiant Firebase mémorisés dans `config.local.cache.json` (revérifiés : bloc + parent), vérification de l'import limitée à la ligne de score (la clôture garde sa vérification complète). Option `--temps`. | Mesuré en bac à sable : import 2,4 s (1,1 s sans nouveauté), clôture environ 15 s, dont l'essentiel est la latence de Notion à chaque suppression. |
| Accès à Firestore | API web de Firestore (REST) appelée directement avec `fetch` et `crypto` (intégrés à Node), au lieu de la bibliothèque `firebase-admin`. Même format de données, même écriture atomique (transaction rejouée en cas de conflit ou de coupure). Vérifié sur le vrai Firestore : ce que le script écrit est lu à l'identique par la bibliothèque officielle, et inversement. | La bibliothèque officielle compte environ 2 400 fichiers : sur le PC (2 antivirus), leur analyse bloquait parfois le lancement 17 à 24 s. Accès direct : 0,1 à 0,4 s. `node_modules` passe de 85 Mo à 1,8 Mo. |
| Tests | `npm test` : 40 tests sur un faux Notion et un faux Firestore, dont les reprises après coupure à chaque étape de la clôture et un cycle complet de deux mois. | Vérifier sans toucher aux vraies données. |
