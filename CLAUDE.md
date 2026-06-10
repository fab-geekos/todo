# Projet Todo — Mémoire & feuille de route

App perso de gestion de tâches. **Un seul fichier `index.html`** (HTML/CSS/JS inline),
versionné sur GitHub (`fab-geekos/todo`). Stockage actuel : `localStorage`.

## Architecture actuelle (à connaître)
- Toute la persistance passe par le module `db.*` (~ligne 1375). **Seules `db.load()` /
  `db.save()` sont à réécrire** pour la migration Firebase ; le reste de l'app ne bouge pas.
- `STORAGE_KEY` = clé localStorage unique aujourd'hui.
- Vues = boutons `.nav-item[data-view="..."]` : todo, today, week, eisenhower, projects,
  contacts, labels, courses, vaccins.
- État global `state` : `{ tasks, projects, contacts, birthDate, vaccineDone, labels }`.

## Décisions validées (NE PAS reremettre en question sans accord)

### 1. Multi-espaces pro/perso par URL
- `?espace=pro` / `?espace=perso` → deux adresses, basculement zéro-clic.
- **Deux espaces sous UN SEUL compte** (pas deux comptes).
- L'« espace » change seulement le *chemin* de données ciblé.
- Modèle pressenti : `users/{uid}/spaces/{pro|perso}/...`.
- Ajout prévu : mini-sélecteur pro/perso dans l'UI (en plus de l'URL).
- **Vues personnalisables par espace** via `settings.enabledViews` (ex. pro sans
  courses ni vaccins). La nav ne dessine que les vues activées.

### 2. Sécurité = Firebase Auth (login Google), PAS de mot de passe en dur
- Mot de passe dans le JS = fausse sécurité (visible au source). Refusé.
- Firebase Auth + security rules verrouillées sur `uid` = vraie protection.
- Un seul compte Google, session persistante par appareil → garde le « zéro clic ».
- ⚠️ Penser à ajouter le domaine d'hébergement dans Firebase → Auth → Authorized domains.

### 3. Accès de Claude = script local (Firebase Admin SDK)
- Petit script `node todo.js add "..."` lancé à la demande → écrit dans Firestore.
- L'app écoute `onSnapshot` → mise à jour live sans recharger.
- ⚠️ La clé de service Firebase reste **locale**, jamais commitée (`.gitignore` déjà en place).
- « Claude chat » seulement si le besoin se confirme plus tard.

## Paramètres de contexte
- **Hébergement** : local + GitHub uniquement. Pas d'autre déploiement pour l'instant.
- **Cible** : version propre sur **ordinateur** (≈80 % de l'usage). **PWA/mobile : reporté.**
- **Coût** : palier gratuit Firebase (Spark) suffisant.
- **Multi-appareils** : OK via Firestore + onSnapshot (dernière écriture gagne au champ).

## Ordre de travail convenu
1. **MAINTENANT (avant migration)** : finir TOUTES les vues + tout ce qui touche à la
   *forme* des données (nouveaux champs/collections). On fige le schéma avant de migrer.
2. Migration Firebase (réécrire `db.load`/`db.save` + Auth).
3. Ajouter le paramètre d'espace pro/perso + vues personnalisables.
4. Brancher le script Claude local.
- Le polish purement visuel peut se faire de chaque côté (plus rapide à itérer maintenant).

## Choix de design à valider ensemble (priorité avant migration)
- **Modèle de données Firestore** (1er choix structurant) : viser robustesse, sécurité,
  lisibilité, maintenance. À proposer en détail avant de coder.
- **Bouton « Exporter (JSON) »** : à coder maintenant (filet de sécurité pour la migration
  + sauvegarde permanente, pur UI, sans risque).

## Avancement (fait, non encore commité)
- **Calendrier (popup date)** : ancré en haut (`.cal-scrim` flex-start) → grandit vers le
  bas quand le mois a plus de semaines ; l'en-tête ◀ ▶ ne bouge plus. Vérifié.
- **Espaces pro/perso (localStorage)** : `ESPACE` lu depuis `?espace=pro|perso` (défaut
  perso). Clé par espace `todo_app_v1__{espace}`. Migration douce : l'ancienne clé unique
  `todo_app_v1` est adoptée par l'espace perso au 1er chargement (backup conservé).
  → Cette plomberie sera **réutilisée telle quelle** par Firebase (seul db.load/save change).
- **Sélecteur pro/perso** : segmented control en haut de la sidebar ; bascule = recharge
  l'URL avec `?espace=`.
- **Export / Import JSON** : menu discret « ⋯ » dans l'en-tête (à côté du thème). Export =
  fichier `todo-{espace}-AAAA-MM-JJ.json`. Import = remplace l'espace courant après
  confirmation. Réutilise `normalizeData` (tolère les clés méta `_app`/`_version`).

## PRINCIPE DIRECTEUR (vaut pour tout le projet)
**Centraliser au maximum.** Une seule source pour chaque paramètre/comportement,
des fonctions réutilisables partout, zéro copier-coller. Chaque vue-liste = un simple
*objet de config* consommé par UN moteur commun. Priorité absolue : code facile à entretenir.

## Nouvelles vues à construire (avant migration) — décidé
Base existante : tâches `parentTaskId` + champ `list` ; courses = déjà une liste persistante
(rayon = racine `list:"courses"`, produit = sous-tâche). Sous-onglets : todoTabs.

**Structure décidée :**
- Les **vues** et leurs **sous-onglets** sont **codés en dur** (fixes).
- Les **catégories/listes + éléments à l'intérieur** sont **éditables** (créés par l'utilisateur).

Famille « checklist » — config par vue :
| Vue | Sous-onglets (en dur) | Cocher | Reset | Catégories |
|---|---|---|---|---|
| Courses (existe) | — | persiste | — | éditables (rayons) |
| À consommer 🎬📚 | À regarder, À lire | **l'item PART** | — | éditables (Films, Docs…) |
| Valise 🧳 | Retour famille, Vacances, Randonnée | persiste | **oui, par sous-onglet** | éditables |
| Autres listes 🗂️ | — | persiste | — | éditables (tes listes) |

Reset « Tout décocher » : **uniquement Valise** pour l'instant ; **un bouton par sous-onglet**
(réinitialiser « famille » n'affecte pas « randonnée »).

Autres familles :
- **🎁 Cadeaux** : lié Contacts + Anniversaires (idées par personne).
- **💡 Idées / notes** : capture rapide, **pas de cases à cocher**.
- **🔧 Entretien récurrent** : moteur des Vaccins, **inséré au calendrier 60 j avant** l'échéance.

Ordre de livraison (1 lot = commit + test en ligne) :
1. ✅ **FAIT — Fondation + Affaires/Voyages** : moteur générique `LIST_VIEWS` (config par vue)
   + helpers `isListRoot/isListTask/...` (anciens `isShopping*` = alias) + `renderListView`,
   `renderListTabs`, `resetListTab`, `addListRoot`. Vue 🧳 mode `flat`, multi-onglets, recherche,
   édition d'affaire. Courses re-routé sur le moteur sans régression.
2. ✅ **FAIT — Multimédia** 📚🎬 (ex-« Médiathèque ») : mode `flat`, 4 sous-onglets en dur
   (📚 read / 🎬 watch / 🎲 boardgames / 🎮 ps4), `removeOnCheck:true` (cocher = vu/lu/joué →
   l'item PART), `search:true`, **pas** de multi-onglets (config `multiAdd` propre à bagages),
   titres non ouvrables. Masquée aussi en pro. Icône nav double-emoji (`.icon-multi`).
   Sous-onglets = `{id, icon, label}` ; helper `subTabLabel` (icône+texte) ; état vide d'un
   onglet = icône du sous-onglet actif.
3. ✅ **FAIT — 🎁 Cadeaux** : vue dédiée (PAS le moteur de listes). Idées stockées SUR le
   contact (`contact.gifts = [{id,title,done}]`, préservé par `normalizeData`). Vue triée par
   anniversaire le plus proche (`nextBirthdayOccurrence`), libellé « 🎂 date · dans X ».
   Saisie en haut = `createPicker` (personne) + idée ; ajout inline par carte ; cocher = offert
   (rayé, descend) ; suppression. `renderCadeaux/giftCard/addGift/contactGifts/giftBdayLabel`.
   Masquée en pro. Réutilise `.checkbox`/`.empty`/`createPicker`/`durationLabel`.
4-5. ✅ **FAIT — 🗂️ Idées / Notes / Autres** (fusion des 2 vues prévues, à la demande user) :
   1 entrée `LIST_VIEWS` `autres` (mode `tree`) + flag `sortDone:true`. Racine = texte libre
   **sans case** (note/en-tête) ; sous-tâches (1 niveau, déjà imposé par le moteur) **cochables,
   persistent, triées cochées-en-bas** (tri dans `taskTreeRows` si `listConfig(...).sortDone`) ;
   suppression par ×. L'ancienne vue Notes séparée (`state.notes`) est **supprimée** ; `migrateNotesToAutres()`
   (init + import) convertit les anciennes notes en racines `list:"autres"`. `state.notes` conservé
   dans le schéma (toujours `[]` après migration) pour relire d'anciennes données. Visible perso ET pro.

Ordre du menu (perso, validé) : Todo · Aujourd'hui · Prochainement · Eisenhower │ Projets ·
Étiquettes · Contacts · Liste de courses · Multimédia · Affaires/Voyages · Cadeaux ·
Idées/Notes/Autres · Vaccins.

**Toutes les vues prévues sont faites.** Reste : la **migration Firebase** (réécrire
`db.load`/`db.save` + Auth) puis le paramètre d'espace côté Firebase et le script Claude local.

Idée d'extension (non faite) : pastille 🎁 sur les cartes d'anniversaire (Today/Anniversaires)
quand la personne a des idées de cadeaux.

Flags de config du moteur : `shape` (tree/flat), `subTabs`, `reset`, `search`+`searchPlaceholder`,
`multiAdd` (chips « Ajouter dans : » + éditeur d'appartenance via `affaireEditable`),
`removeOnCheck` (cocher supprime l'item). Vues masquées en pro : courses/bagages/mediatheque/vaccins.

Note technique moteur : `state.listTab = {}` (sous-onglet actif par vue) ; classe body
`view-list` (ex `view-courses`) ; conteneur HTML `#listTabs`. Ajouter une vue-liste =
1 entrée dans `LIST_VIEWS` + 1 bouton de nav (+ sous-onglets si besoin).

Le moteur a DEUX formes (`shape`) :
- **`tree`** (défaut, ex. courses) : racines = catégories (pas de case, bouton coche tout),
  items = sous-tâches. Helper `isListCategory(t)`.
- **`flat`** (ex. Affaires/Voyages) : racines = items cochables directement (pas de catégories) ;
  triés non-cochés en haut / cochés rayés en bas ; `resetListTab` décoche les racines.
  Saisie rapide = sélecteur multi-onglets `#listAddTabs` (« Ajouter dans : ») → crée l'affaire
  dans tous les sous-onglets cochés d'un coup (au moins l'onglet actif). Chips = `.list-add-chip`.
`isShoppingRoot`=`isListRoot` (exclusions Todo) ; comportement « catégorie » via `isListCategory`.

Lot 1bis (retours user) : Affaires/Voyages passée en mode `flat` (affaires, pas catégories)
+ multi-onglets à l'ajout. FAIT + commité (b53ab3f).

Lot 1ter (retours user) — FAIT, commité :
- Édition d'une affaire : clic ouvre l'éditeur (épuré) avec chips d'appartenance aux
  sous-onglets (ajouter/retirer après création). Copies liées par champ `group` (partagé
  à l'ajout, repli sur l'id pour le legacy) ; `affaireGroup(t)`. Renommer = renomme tout
  le groupe. Refuse de retirer le dernier onglet. Fonctions `renderEditorAffaireTabs`,
  `toggleAffaireTab` ; section HTML `#editAffaireTabs`/`#editAffaireChips`.
- Recherche par vue-liste (config `search:true`, ex. bagages) : `#listSearch` réutilise
  `.search-box`/`.search-input` (contacts) ; `state.listQuery` filtré dans `renderListView`,
  scopé au sous-onglet actif ; reset au changement de vue/onglet.
- Masquage de vues par espace : `ESPACE_HIDDEN_VIEWS = { pro: [courses,bagages,vaccins] }`,
  `applyEspaceViews()` (cache nav + repli sur todo), garde dans `navigate()`.

## Polissage (lot pré-migration, fait)
- **Espaces perso/pro = totalement indépendants** (clés `todo_app_v1__perso|pro`, aucune donnée partagée). Confirmé.
- Sous-titres de vue **vidés** (todo, today→garde la date *capitalisée* « Mardi 9 juin », week, eisenhower,
  projects, cadeaux, mediatheque, bagages, autres). `viewSub` vide = 0px (pas d'espace). Sous-titres
  dynamiques récurrentes/anniversaires supprimés. Placeholder quick-add tâches = « Nouvelle tâche ».
- Placeholders raccourcis : Multimédia « Ajouter un titre », Affaires/Voyages « Ajouter une affaire ».
- `.list-search` pleine largeur (plus de `max-width`).
- **Courses & vues-listes tree** : champ « + » persistant en bas d'une catégorie dépliée
  (`.list-additem` dans `taskTreeRows`, handler Enter dans la délégation `.main` + clic = focus)
  → ajout d'item sans ouvrir l'éditeur. Le clic sur le rayon (éditeur) reste possible.
- **Cadeaux** : cartes **repliées par défaut** (chevron, `state.expandedGifts`), n'affichent que
  nom + anniversaire au format **« 3 Janvier - Dans X mois »** (jours le dernier mois, `giftBdayLabel`).
  Recherche de personne (`state.giftSearch`, `#giftSearch`) entre la zone d'ajout et la liste.
  Ajout (haut/inline) déplie la carte + refocus.

## Polissage (lot 2, fait)
- Courses : sous-titre vidé, placeholder « Ajouter un rayon ». `.list-search` re-cappée à
  `max-width:420px` (Multimédia/Affaires : le full-width ne plaisait pas ; alignement dynamique
  exact sur le dernier onglet pas faisable proprement en CSS).
- Cadeaux : 🎂 remis devant la date (`🎂 3 Janvier - Dans X mois`).
- **Catégories d'arbre (rayons, notes) ne s'ouvrent PLUS** (éditeur retiré) : `canOpen =
  !isListTask || affaireEditable`. Chevron **toujours** présent sur une catégorie (déplier même
  vide). Courses : **recherche de produits sous le nom du rayon** (config `itemSearch:true`,
  `state.rowSearch[rayonId]`, filtrage live en DOM via listener `input` sur `.main`, pas de
  re-render → focus gardé ; `taskTreeRows` filtre aussi au render). Idées/Notes/Autres : pas de
  recherche interne (pas de `itemSearch`). NB : plus de renommage de rayon/note via éditeur.
- Sidebar : **« Bonjour Fabien »** (`.side-greeting`) sur la ligne du hamburger (sidebar
  `padding-top` 64→14px, `margin-left:50px` pour dégager le hamburger fixe), bord droit aligné
  sur le sélecteur perso/pro.

## Polissage (lot 3 — drag&drop + cadeaux/contacts, fait)
- **Drag-and-drop des vues-listes** : `makeDraggable` généralisé avec un mode « libre » (config
  `getItem(e)` → élément à déplacer, sinon mode colonnes inchangé). Sur `#taskList` : on déplace
  les **racines** (cartes `.task`, toutes les vues-listes) et, si `cfg.reorderItems`, les **items**
  (`.prod-row`, courses uniquement). `persist` = `reorderFromDOM` (`#taskList > .task` ou `.prod-row`).
  Curseur `grab` sur `body.view-list .task-row`. Un clic (sans bouger) reste un clic (seuil 6px).
- **Courses produits** : `sortDone:true` → non cochés en haut (ordre manuel/drag, stable), cochés en
  bas **triés par `completedAt` décroissant** (le + récemment coché en tête des cochés). Comparateur
  dans `taskTreeRows`. Idem Idées/Notes/Autres (déjà `sortDone`), mais sous-items **non** draggables
  (`reorderItems` absent).
- **Cadeaux** : ajout NE déplie PLUS la carte (état conservé). Tri commutable `state.giftSort`
  (`bday`/`name`) via `#giftSort` (.subview-btn). 🎂 devant la date.
- **Contacts** : **Entrée** dans le champ recherche = crée un contact du texte saisi. **Icône genre**
  (`contact.icon` : 👨/👩/👦/👧) choisie dans la fiche (`#ceIcons`), affichée avant le nom dans
  Contacts ET Cadeaux. Préservée par `normalizeData` (objet contact tel quel).
- Sidebar : greeting `justify-content:center` (plus centré).

## Polissage (lot 4 — retours user, fait)
- **Cadeaux : tri en menu déroulant** (comme Todo) : `#giftSort` = `<select class="sort-select">`
  (`bday` « Trier par date » / `name` « Trier par nom ») dans une `.toolbar`, listener `change`.
  Plus de `.subview-btn` de tri.
- **Icône genre SUPPRIMÉE partout** (annule lot 3) : plus de `#ceIcons` (HTML/CSS/JS), plus
  d'affichage de `contact.icon` dans Contacts ni Cadeaux. La donnée `icon` éventuelle reste
  inerte dans les vieux exports (toujours tolérée par `normalizeData`).
- **Contacts : champ d'ajout dédié** `#contactAddInput` (placeholder « Nom du nouveau contact… »)
  + bouton `+ Contact` dans `.contacts-bar`, recherche `#contactSearch` EN DESSOUS
  (`.contacts-search`). Entrée/bouton avec nom = crée direct ; bouton sans nom = fiche vierge
  ouverte. L'Entrée-dans-la-recherche (lot 3) est supprimée.
- **Idées/Notes/Autres : sous-éléments draggables** (`reorderItems:true` dans la config `autres` —
  une ligne, le moteur lot 3 fait le reste).
- **Éditeur d'affaire compact** : classe `.editor.affaire-mode` (togglée dans `openEditor`) →
  `.editor-top` en absolu (croix sur la ligne du titre, plus de bandeau/trait gris), breadcrumb
  masqué (sinon sa marge décale — son `display:flex` l'emporte sur l'attribut `hidden`), et la
  phrase « Dans quels onglets ? » retirée du HTML (les chips se suffisent).
- **Clic n'importe où sur une ligne à chevron = (dé)plier** : fallback dans la délégation `.main`
  (`else if (!action && row.querySelector(".task-chevron")) toggleChildren(id)`). Ne s'applique
  que si aucun `data-action` ne matche → l'ouverture d'éditeur (task-body `data-action="edit"`)
  et le drag (clic immobile < 6px = clic ; après drag, garde `lastDragEnd`) sont préservés.
  Cadeaux : déjà le cas (`.gift-head` porte `data-action="gift-expand"`).

## Règles de collaboration
- **Committer + pusher systématiquement à la fin de chaque lot de modifs** (demande permanente
  du user, 10/06/2026) : il teste directement en ligne après chaque lot. Commit direct sur
  `main` (c'est la branche servie en ligne) — l'ancienne règle « jamais sans demande » est levée.
- Garder un seul `index.html` (pas de fichiers séparés).
