# Projet Todo — Mémoire & feuille de route

App perso de gestion de tâches. **Un seul fichier `index.html`** (HTML/CSS/JS inline),
versionné sur GitHub (`fab-geekos/todo`). **Stockage : Firebase/Firestore** (login Google +
sync live `onSnapshot`), avec un **cache `localStorage`** immédiat et hors-ligne par-dessus.

## Architecture actuelle (à connaître)
- Toute la persistance passe par le module `db.*`. **`db.save()` = écriture localStorage
  immédiate + écriture Firestore débouncée (600 ms) si connecté ; `db.load()` = repli local
  instantané, puis `onSnapshot` pilote la sync live.** Le reste de l'app n'appelle que `db.*`.
- ⚠️ **`flushFirestore()`** force l'envoi cloud en attente sur `visibilitychange`/`pagehide`
  (sinon une modif faite juste avant fermeture était perdue ; cf. section « Persistance »).
- `STORAGE_KEY` = clé localStorage par espace (cache) ; la source de vérité est le doc Firestore
  `users/{uid}/spaces/{pro|perso}` (blob unique, modèle validé — cf. mémoire `firestore-data-model`).
- Vues = boutons `.nav-item[data-view="..."]` : todo, today, week, eisenhower, projects,
  contacts, labels, courses, mediatheque, bagages, cadeaux, autres, vaccins.
- État global `state` (champs persistés) : `{ tasks, projects, contacts, birthDate, vaccineDone,
  labels, notes, mit }`.

## Décisions validées (NE PAS reremettre en question sans accord)

### 1. Multi-espaces pro/perso par URL
- `?espace=pro` / `?espace=perso` → deux adresses, basculement zéro-clic.
- **Deux espaces sous UN SEUL compte** (pas deux comptes).
- L'« espace » change seulement le *chemin* de données ciblé.
- Modèle pressenti : `users/{uid}/spaces/{pro|perso}/...`.
- Ajout prévu : mini-sélecteur pro/perso dans l'UI (en plus de l'URL).
- **Vues personnalisables par espace** via `settings.enabledViews` (ex. pro sans
  courses ni vaccins). La nav ne dessine que les vues activées.

### 2. Sécurité = Firebase Auth (login Google), PAS de mot de passe en dur — ✅ FAIT
- Mot de passe dans le JS = fausse sécurité (visible au source). Refusé.
- Firebase Auth + security rules verrouillées sur `uid` = vraie protection.
- Un seul compte Google, session persistante par appareil → garde le « zéro clic ».
- ⚠️ Penser à ajouter le domaine d'hébergement dans Firebase → Auth → Authorized domains.
- **En place** : porte de login Google (`#authGate`), `onAuthStateChanged` → `attachSpace`,
  gestion spéciale de l'embed Notion (Storage Access API avant l'auth).
- ⚠️ **Navigateurs intégrés (in-app webviews)** : Google REFUSE l'OAuth dans les webviews de
  Messenger/Facebook/Instagram/TikTok… → **erreur 403 `disallowed_useragent`** (impossible à
  contourner côté code, c'est une règle Google). `isInAppBrowser()` (UA) détecte ces cas et,
  sur l'`#authGate`, masque le bouton Google (`#authSignIn`) au profit d'un bandeau `#authInApp`
  (« ouvrir dans Safari/Chrome » + bouton « Copier le lien »). Indépendant du flux iframe Notion.
  ➡️ Pour partager l'app : envoyer le lien hors messagerie, ou dire d'ouvrir dans un vrai navigateur.

### 3. Accès de Claude = script local (Firebase Admin SDK) — ⏳ reste à faire
- Petit script `node todo.js add "..."` lancé à la demande → écrit dans Firestore.
- L'app écoute `onSnapshot` → mise à jour live sans recharger.
- ⚠️ La clé de service Firebase reste **locale**, jamais commitée (`.gitignore` déjà en place).
- « Claude chat » seulement si le besoin se confirme plus tard.

## Paramètres de contexte
- **Hébergement** : **GitHub Pages** — URL en ligne **https://fab-geekos.github.io/todo/**
  (vérifié 18/06/2026). **Auto-déploiement** à chaque push sur `main` via le builder natif
  GitHub Pages (`pages-build-deployment`) → pas de `firebase deploy` ni de workflow `.github` à gérer.
  ⚠️ `fabien---todo.firebaseapp.com` n'est **que** l'`authDomain` OAuth (poignée de main Google),
  **pas** l'hébergement (les domaines Firebase Hosting `*.web.app`/`*.firebaseapp.com` renvoient 404).
- **Cible** : version propre sur **ordinateur** (≈80 % de l'usage). **PWA/mobile : reporté.**
- **Coût** : palier gratuit Firebase (Spark) suffisant.
- **Multi-appareils** : OK via Firestore + onSnapshot (dernière écriture gagne au champ).

## Ordre de travail convenu
1. ✅ Finir TOUTES les vues + figer la *forme* des données avant de migrer.
2. ✅ Migration Firebase (`db.load`/`db.save` réécrits + Auth Google + `onSnapshot`).
3. ✅ Paramètre d'espace pro/perso (URL `?espace=` + sélecteur) + vues masquées par espace
   (`ESPACE_HIDDEN_VIEWS`).
4. ⏳ Brancher le script Claude local (Firebase Admin SDK) — **seul point restant**.
- Le polish purement visuel peut se faire à tout moment (rapide à itérer).

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
   onglet = icône du sous-onglet actif. **MAJ lot 8** : 2e niveau de genres + compteurs (cf. bas).
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

**Toutes les vues prévues sont faites, ET la migration Firebase est faite** (login Google +
Firestore `onSnapshot` + cache hors-ligne `enablePersistence`, doc-blob par espace
`users/{uid}/spaces/{pro|perso}`). **Reste :** le **script Claude local** (Firebase Admin SDK,
décision #3). La sécurité multi-appareils est traitée au lot 12 (cf. « Sync multi-appareils »).

## Persistance Firebase (FAIT — à connaître absolument)
- `db.save()` : 1) `localStorage` tout de suite ; 2) `spaceRef.set(...)` **débouncé 600 ms**.
- **Filet anti-perte** : `flushFirestore()` pousse l'écriture en attente **immédiatement** sur
  `visibilitychange` (onglet masqué) et `pagehide` (fermeture/navigation). Sans ça, une modif faite
  dans la fenêtre de 600 ms avant fermeture n'atteignait jamais le cloud, puis `onSnapshot`
  rechargeait la copie cloud plus ancienne et **écrasait** la copie locale → **perte de données**.
  Flag `_pendingWrite` = pas de double écriture.
- `_lastSync` (stable-stringify) = anti-écho de nos propres écritures ; `enablePersistence` rejoue
  une écriture déjà émise même si le réseau n'a pas répondu avant fermeture.
- ⚠️ Le comportement « le cloud gagne toujours au chargement » a été **remplacé** au lot 12
  (il détruisait les données en multi-appareils) — voir la section dédiée plus bas.

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
Exclusions Todo/compteurs via `isListRoot` ; comportement « catégorie » via `isListCategory`.
(Les anciens alias `isShoppingRoot`/`isShoppingTask` ont été supprimés au lot 5 — un seul nom par helper.)

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
  `state.rowSearch[rayonId]`, filtrage **100 % en DOM** — cf. lot 6). Idées/Notes/Autres : pas de
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

## Nettoyage (lot 5 — chasse aux résidus/redondances, fait)
Audit systématique (fonctions/CSS/ids/variables définis vs utilisés) puis purge prudente —
en cas de doute (usage dynamique, ex. `var(--st-${status})`, classes `q-*`), on NE touche PAS.
- **Supprimé (mort)** : fonction `formatDue` ; CSS `.field`/`.btn`/`.btn-primary`/`.btn-ghost`/
  `.btn-danger`/`.muted-soon` + règle dark associée ; ids orphelins `espaceSwitch`/`giftSearchBox`/
  `weekAddFlags` ; variable `ok` inutilisée ; `MONTH_LONG` (doublon exact de `MONTH_LABELS`).
- **Alias supprimés** : `isShoppingRoot`→`isListRoot`, `isShoppingTask`→`isListTask` (remplacés
  à tous les call-sites).
- **Helpers UI ajoutés** (à côté de `$`) : `setActiveTab(container,key,value)` (surbrillance
  d'onglet, 3 sites), `setOverlay(id,open)` (modales + overflow body, 6 sites),
  `onEnter(el,fn)` (Entrée = valider, 3 sites).
- **2 bugs latents corrigés** : listener `.subview-btn` global → scopé `.proj-subviews`
  (un clic sur un onglet Todo/Projets écrasait `state.projSub`) ; suppression d'une tâche
  depuis l'éditeur ne rétablissait pas le scroll (`overflow` restait `hidden`).
- NB : `db.save(); render();` (6 sites) laissé tel quel — idiome clair, l'envelopper
  n'apporterait rien. `state.notes` conservé exprès (relecture d'anciennes données).

## Polissage (lot 6 — vue Courses : recherche produits + rayons, fait)
- **Déplier un rayon = curseur direct dans « Rechercher un produit »** : `toggleChildren` focalise
  le `.row-search-input` du rayon juste déplié (seulement si la catégorie a `itemSearch`, ex. courses).
- **Recherche produits 100 % en DOM (fin de la désync)** : `taskTreeRows` rend **tous** les produits
  (plus de `kids.filter` au render). Le filtrage masque/affiche par `display` via `applyRowSearch(rayonId)`,
  appelé à la frappe (listener `input`) **ET** après chaque render (`applyRowSearches()` en fin de
  `renderListView`). Comme la liste complète reste **toujours** dans le DOM, effacer/raccourcir la
  recherche réaffiche les produits correspondants même si un render survient pendant la saisie
  (avant : un render mid-recherche retirait les non-correspondants du DOM → ils ne revenaient qu'en
  refermant/rouvrant le chevron).
- **Rayon : clic simple vs double-clic** (`categoryRowClick`, état `_pendingCatClick`, `CAT_DBLCLICK_MS=250`) :
  clic simple = (dé)plier **après un court délai** ; double-clic **rapide** = renommer le rayon **sans**
  (dé)plier (le pliage en attente est annulé). Routé depuis la délégation `.click` pour les catégories
  (`isListCategory(getTask(id)) ? categoryRowClick(id) : toggleChildren(id)`, 2 sites : chevron + corps).
  Le `dblclick` natif est **réservé aux items** (produits, sous-éléments sans chevron) : il ignore
  désormais les catégories (`!isListCategory(...)`).

## Hygiène du blob (lot 7 — purge des tâches terminées, fait)
Objectif : empêcher l'accumulation infinie des tâches **cochées** dans le blob (seul vrai moteur de
croissance vers la limite **1 Mio/document** Firestore ; les suppressions et les récurrences, elles,
n'accumulent pas — `db.remove`/`deleteTask` filtrent vraiment, `advanceRecurrence` mute en place).
- **`purgeCompletedTodos(maxAgeDays)`** (cœur) : supprime les **arbres de tâches todo terminés**.
  Périmètre STRICT — `isRoot && completed && !isListTask && subtreeAllCompleted(id)` :
  - racines **uniquement** → on retire l'**arbre entier** d'un coup (jamais une sous-tâche isolée = **zéro orphelin**) ;
  - `subtreeAllCompleted` = garde-fou : on ne purge un arbre que s'il est terminé de fond en comble
    (protège même si l'invariant « parent coché ⟹ enfants cochés » était cassé) ;
  - **toutes les vues-listes épargnées** via `isListTask` (Courses, Affaires, Multimédia, Idées/Notes/Autres
    gardent volontairement leurs items cochés). `maxAgeDays=null` → tout âge ; sinon filtre sur `completedAt`.
- **Purge auto** `maybeAutoPurge()` : `AUTO_PURGE_DAYS = 90`, **1× par chargement** (`_autoPurgeDone`).
  Une tâche terminée **sans `completedAt`** (donnée ancienne) est **épargnée** en auto (âge inconnu).
  Branchée sur les **3 points d'entrée** de `onSnapshot` où l'état devient autoritatif (cloud identique
  au cache → cf. early-return ligne « déjà identique », cloud différent, seed) — sinon elle ne tournerait
  jamais sur le chemin mono-appareil courant (cloud == cache).
- **Bouton manuel** `🧹 Vider les tâches terminées` (menu ⋯, `#purgeDoneBtn` → `purgeCompletedDoneNow`) :
  purge **tout âge** après `confirm()` (action définitive, pas d'undo). `state.mit` = texte libre (pas
  d'id) → aucune référence pendante à nettoyer.

## Multimédia — genres (2e niveau) + compteurs (lot 8, fait)
- **2 niveaux d'onglets** : un sous-onglet principal (`subTabs`) peut lui-même porter un tableau
  `subTabs` (les « genres »). Multimédia → **À lire** = Romans / BDs / Comics / Mangas ;
  **À regarder** = Films / Dessin animé / Série / Documentaires. **Jeux de société** et **PS4**
  n'ont pas de genres (la 2e rangée se masque). Générique : n'importe quelle vue-liste à `subTabs`
  peut activer des genres sur certains onglets — rien n'est codé en dur « mediatheque ».
- **Donnée item** : champ `tab2` = genre (en plus de `tab` = onglet principal). `addListRoot`
  accepte `tab2` ; la saisie rapide met `tab2 = activeGenre(view)` (l'onglet/genre **actif = la
  destination**, comme le reste du moteur). `tab2` préservé tel quel par `normalizeData`.
- **Helpers** (à côté de `activeListTab`) : `activeSubTab` (objet du sous-onglet actif),
  `activeGenres` (ses genres ou null), `activeGenre` (genre actif, mémorisé par couple
  `state.listTab2["{vue}/{onglet}"]`, défaut = 1er genre), `itemGenre(t)` (genre EFFECTIF d'un
  item = `tab2` avec repli sur le 1er genre de son onglet → filet legacy), `listTabCount(view,
  tab, genre?)` (nb d'items non cochés).
- **UI** : 2e conteneur `#listSubTabs` (`.todo-tabs.list-subtabs`) sous `#listTabs`, rempli par
  `renderListSubTabs` (appelé depuis `renderListTabs`). Clic `[data-listtab2]` → `state.listTab2`.
  `render()` masque `#listSubTabs` hors vue-liste à onglets.
- **Compteurs** : flag `tabCount:true` (mediatheque) → badge `.tab-count` sur chaque onglet
  principal (total) ; les genres affichent **toujours** leur compteur. Filtrage de la liste
  (`renderListView`) scopé `tab` **puis** genre actif via `itemGenre`.
- **Migration** `migrateMediaGenres()` (init + import + onSnapshot apply + seed, à côté de
  `migrateNotesToAutres`) : anciens titres **À lire** sans `tab2` → **Romans**, **À regarder** →
  **Films** (idempotent, `db.save()` seulement si ça change). Le repli `itemGenre` couvre déjà
  l'affichage si la migration n'a pas encore tourné.
- **Déplacer un titre entre genres** (corriger une erreur, ex. Films → Documentaires) : petit
  `<select class="genre-select">` sur chaque carte concernée (helper `taskGenres(t)` → genres de
  l'onglet de l'item, sinon rien). `change` (délégué sur `.main`) → `db.update(id,{tab2})` +
  `render()` : l'item quitte la vue du genre courant, le compteur cible monte. **Pas de drag**
  (chaque genre est une vue filtrée → il faudrait viser un onglet ; fragile au tactile). `select`
  ajouté à l'exclusion `getItem` du drag pour ne pas déclencher un déplacement de carte.

## Affaires/Voyages + drag global (lot 8, fait)
- **Compteurs par sous-onglet** (Affaires/Voyages) : flag `tabCount: true` ajouté à la config
  `bagages`. Réutilise l'infra existante (`renderListTabs` → `tabCountBadge(listTabCount(...))`,
  `.tab-count`). `listTabCount` compte les **racines NON cochées** du sous-onglet → en mode flat =
  affaires non cochées. (Dispo aussi pour toute vue-liste en activant le flag.)
- **Renommer une affaire** : crayon `✎` (action `list-rename`) désormais affiché aussi sur les
  affaires (`!canOpen || affaireEditable(task)`), + **double-clic** rapide (`affaireRowClick`,
  calqué sur `categoryRowClick` : clic simple = ouvrir l'éditeur **différé 250 ms**, double-clic =
  renommer). ⚠️ Renommage **groupe-aware** : `renameListItem(id,title)` renomme TOUTES les copies
  multi-onglets d'une affaire (comme l'éditeur) ; `startListRename` l'utilise (avant : `db.update`
  d'une seule tâche → désync). Le `dblclick` natif ne traite que `.task-row.no-open` → pas de conflit.
  **Verrou pendant l'édition** (clic dans le titre = placer le curseur, PAS ouvrir l'affaire) :
  garde `e.target.closest('[contenteditable="true"]')` en tête du handler clic `.main` + garde
  temporelle `lastRenameEnd` (300 ms, calquée sur `lastDragEnd`, posée dans `finish()`) pour que le
  clic qui clôt l'édition ne rouvre pas l'éditeur. Se lève seul à la fin (span non éditable + re-render).
  ⚠️ **DÉCISION VALIDÉE (user, 22/06/2026) — À CONSERVER** : en pratique (mobile), taper une affaire
  **ouvre quand même l'éditeur** (titre + chips sous-onglets, clavier actif), et le user **préfère
  ça** (corriger le titre ET les sous-onglets d'un coup). Ne PAS chercher à bloquer davantage
  l'ouverture. Les gardes ci-dessus restent (inoffensives ; utiles pour l'édition inline pure via ✎).
- **Auto-défilement du drag (générique, toutes vues)** : `makeDraggable` enrichi. `onDragPointerMove`
  mémorise `drag.lastX/lastY` puis délègue à **`updateDragPosition(x,y)`** (extrait : fantôme +
  cible de dépôt). `startDrag` lance une boucle `requestAnimationFrame(autoScrollLoop)` ; près d'un
  bord (`AUTOSCROLL_EDGE=72`), défile la **fenêtre** en vertical et le **scroller horizontal le plus
  proche** (`horizontalScroller` : semaine desktop, Kanban) en X, vitesse `edgeSpeed` (gradient,
  max `AUTOSCROLL_MAX=18`/frame), puis `updateDragPosition` recible. `cleanupDrag` fait
  `cancelAnimationFrame`. ⚠️ **`overflow:hidden` retiré de `body.is-dragging`** (il bloquait le
  `window.scrollBy`) ; le scroll natif au doigt reste bloqué par `onDragTouchMove` (preventDefault).

## Eisenhower (recentrage) + imbrication par drag (lot 9, fait)
- **Vue Eisenhower renommée « Eisenhower / Priorités »** (nav `#nav` + titre `titles.eisenhower`)
  — choix user (plus parlant, cohérent avec « Priorités du moment » et le tri « par priorité »).
- **Case « Éliminer » masquée** dans la vue **globale** ET la **synthèse Projets** (« Priorités du
  moment ») : constante `EISEN_VIEW_QUADRANTS = ["faire","planifier","deleguer"]` passée en
  `opts.quadrants` à `renderEisenhowerInto`. La **matrice d'un projet ouvert** (`projEisenGrid`)
  garde les **4 cases** (défaut `QUADRANT_ORDER`). Grille 2×2 inchangée → coin bas-droite vide
  (= l'emplacement « Éliminer », cohérent).
- **Tri par échéance croissante dans TOUTES les matrices** : chaque case triée
  `(a.completed - b.completed) || byDueDateAsc(a,b)` (cochées en bas, sans date en fin).
  `byDueDateAsc` extrait et partagé avec le tri Todo « par échéance » (`sortTasks`).
- **Matrice d'un projet ouvert : tâches cochées visibles** (`opts.showCompleted:true`, poussées
  en bas). Vue globale + synthèse : cochées toujours exclues (défaut `showCompleted:false`).
- **`reorder:false` sur les 3 matrices** (`setupEisenBoard`) : le drag n'y change plus que la
  **case** (priorité) ; il ne réordonne plus (le tri date primait, et `reorderFromDOM` aurait
  écrasé l'ordre manuel global de `state.tasks`).
- **Drag-to-nest (Todo + Aujourd'hui + Semaine + Eisenhower + liste/matrice de projet)** : glisser
  une tâche au **centre** d'une autre = en faire une **sous-tâche** ; sur les **bords** d'une racine
  = réordonner. Cœur partagé : `nestRowUnder` (`.task-row` sous le pointeur via `elementFromPoint`,
  hors tâche glissée), `rowDropIntent` (racine → tiers haut/bas = before/after, centre = nest ;
  sous-tâche → toute la ligne = nest), `canNestUnder`/`nestTaskUnder`, `clearNestFeedback`.
  - **Mode libre** (`#taskList` en vue Todo, `#projTaskList`) : hooks `freeMove`/`freeDrop` →
    `freeNestMove`/`freeNestDrop` (réordonne via `reorderFromDOM("#"+drag.list.id+" > .task")`).
  - **Mode colonnes** (`#todayBoard`, `#weekGrid`, boards Eisenhower) : flag **`config.nestable`**.
    Au centre d'une ligne → imbrique (pas de changement de colonne/priorité/jour) ; ailleurs →
    comportement normal de la vue (réordonner / replanifier / changer de quadrant).
  - `nestTaskUnder` : pose `parentTaskId`, **retire priorité + récurrence** (une sous-tâche n'en a
    pas), **hérite le `projectId` du parent** en cascade (`setProjectDeep` → ⚠️ nesting inter-projets
    réaffecte le projet), déplie le parent, `refreshCompletionUpwards`. Garde-fous `canNestUnder` :
    pas de cycle, `taskDepth(cible) + subtreeHeight(glissé) ≤ MAX_TASK_DEPTH` → sinon `.nest-forbidden`
    (dépôt sans effet). Retour visuel `.nest-target`/`.nest-forbidden` ; `.dragging` généralisé
    (pointer-events:none) pour que `elementFromPoint` vise les autres lignes.
  - **EXCLU** (volontaire, demande user) : vues-listes (courses, multimédia, affaires/voyages,
    cadeaux, idées/notes/autres), contacts, vaccins. Le Kanban (cartes projet) n'est pas concerné.
  - ⚠️ **Limites connues** : les **sous-tâches ne sont pas draggables** (pas de carte propre) → pas
    de « ressortir »/promouvoir par glisser ; pas d'undo d'imbrication. En Semaine/Aujourd'hui, une
    sous-tâche **datée** reste affichée à sa date (rendu agenda par date, pas par hiérarchie).
  - **Agenda (Aujourd'hui/Semaine) — fin du doublon** : ces vues listent toutes les tâches datées
    (racines ET sous-tâches). Une sous-tâche datée dont le parent est présent (le même jour pour la
    Semaine) est retirée du niveau racine (elle s'affiche imbriquée) ; si le parent est absent, elle
    reste au niveau racine. Filtres dans `visibleTasks` (today) et `renderWeek` (par jour).

### ⚠️ DÉCISION VALIDÉE (user, 23/06/2026) — un parent ne s'auto-termine PLUS
`refreshCompletionUpwards` **n'auto-COCHE plus** un parent quand tous ses enfants sont cochés : le
parent reste visible avec sa progression à 100 % (ex. « 1/1 fait »), et **c'est l'utilisateur qui le
coche**. On GARDE l'auto-DÉCOCHE (parent fait + enfant redevenu à faire / nouvelle sous-tâche →
parent rouvert). Motivation : en agenda, cocher la dernière sous-tâche faisait disparaître le parent
(auto-terminé → masqué), donc on ne voyait jamais « la sous-tâche cochée sous le parent ». Vérifié
en preview (4 cas : check sous-tâche, check parent manuel = cascade, uncheck sous-tâche = auto-décoche,
addSubtask sur parent fini = rouvre). Ne PAS rétablir l'auto-complétion sans accord.
➡️ **Exception validée (lot 11)** : la **checklist Cadeaux › À faire** (`isChecklistTask`) fait
EXCEPTION — le parent s'y auto-coche quand tous ses enfants sont cochés. La règle ci-dessus reste
la norme partout ailleurs (Todo, agenda).

## Nettoyage/maintenabilité (lot 10, fait)
Audit complet (script ad hoc : fonctions/constantes/ids définis vs référencés, classes CSS,
littéraux répétés, blocs dupliqués) → **code déjà très sain** : 0 fonction/constante/id morts,
échappement `esc()` systématique (aucun `innerHTML` brut ni `value`/`placeholder` non échappé),
quasi aucune duplication. Changements appliqués (sûrs, vérifiés en preview) :
- **CSS mort retiré** : `.side-label .soon-tag` et `.side-date-input(:focus)` (résidus d'un ancien
  champ date de sidebar). NB : `q-planifier/q-deleguer/q-eliminer` et `vac-soon/vac-overdue` sont
  **dynamiques** (`"q-"+clé`, `vac-${st.cls}`) → conservés (faux positifs d'audit).
- **DRY** : la déduplication agenda (sous-tâche déjà imbriquée sous son parent présent) factorisée
  en `withoutNestedDuplicates(list)`, utilisée par `visibleTasks` (today) ET `renderWeek` (par jour).
- Nombres calendaires (28-31, 365) laissés inline (plus lisibles que des constantes). Les deux
  pickers (étiquettes vs `createPicker`) partagent ~4 lignes de boilerplate : non factorisés
  (concerns distincts, gain < risque — prudence lot 5).

## Cadeaux (sous-vues) + Contacts/Anniversaires + checklist (lot 11, fait)
- **Contacts — carte épurée** : plus de « Aucun projet délégué » (les projets ne s'affichent que
  s'il y en a) ; sous les projets, compteur `🎁 N idée(s) de cadeau` (masqué si 0). **Fiche contact** :
  bloc lecture seule en bas (juste au-dessus de Supprimer, séparé par un liseré via `#ceLinked:not(:empty)`)
  = projets délégués (puces) + liste des idées de cadeau (offertes barrées). `contactLinkedHtml(c)`.
- **Vue Cadeaux = 2 sous-vues** (onglets `.subview-tabs` `#cadeauxSubtabs`, `state.cadeauxSub`) :
  **💡 Idées** (l'existant par personne) et **✅ À faire** (nouveau). Panneaux `#cadeauxIdeesPane` /
  `#cadeauxFairePane` montrés/masqués dans `renderCadeaux`.
- **Sous-vue « À faire » = checklist imbriquée** (racine → 2 sous-niveaux, `MAX_TASK_DEPTH=3`),
  **plusieurs racines**, **tout cochable**. Réutilise le moteur de tâches via un **nouveau `shape:"checklist"`**
  dans `LIST_VIEWS` (clé `cadeauxfaire`, `GIFT_TODO_LIST`, PAS une vue de nav) → exclu du Todo/agenda
  comme toute vue-liste (`isListView` vrai) mais **case + nesting partout**. Helper `isChecklistTask`.
  Généralisations : `canAddChild` (nesting jusqu'à MAX pour checklist), `addSubtask` (autorisé sous une
  checklist). Rendu **manuel** dans `#cadeauxView` (`renderGiftTodo` → `renderTasksInto($("giftTodoList"),…)`).
  Cocher/×(undo)/+ passent par la délégation `.main` (le conteneur y est inclus). Renommer = double-clic.
- **Drag & drop dédié `#giftTodoList`** (racines ET sous-tâches, tout le sous-arbre suit) : geste appliqué
  au **drop sur le modèle de données** (`giftMoveSubtree` réordonne un bloc contigu de `state.tasks`) →
  ordre **réellement persisté** (l'ancien chemin partagé `freeNestDrop`/`reorderFromDOM` ne persistait pas
  ici). Survol d'une ligne : tiers haut = **avant**, tiers bas = **après** (même niveau), centre = **imbriquer**.
  Garde-fous : profondeur ≤ 3, pas de dépôt dans sa propre descendance. Feedback `.drop-before`/`.drop-after`
  (+ `.nest-target`/`.nest-forbidden` réutilisés) ; `clearNestFeedback` étendu ; `giftDragMove`/`giftDragDrop`.
- **Cochés en bas + auto-cochage (checklist)** : à chaque niveau, un élément coché descend en **dernière
  position** (racines triées dans `renderGiftTodo`, sous-tâches via `sortDone` de `taskTreeRows`).
  Comparateur factorisé `doneComparator(a,b,recentLast)` : `recentLast=true` (checklist, `doneRecentLast`)
  = dernier coché en dernier ; `recentLast=false` (Courses/Idées, inchangé) = dernier coché en tête.
  **Auto-cochage du parent** quand tous ses enfants sont cochés, en **cascade** (auto-décochage symétrique) —
  `refreshCompletionUpwards` gère les 2 sens, garde-fou `isListRoot` relâché pour les racines checklist,
  auto-coche **gated `isChecklistTask`** (cf. exception de la décision du 23/06 ci-dessus).
- **Anniversaires déplacés Todo → Contacts** : l'onglet Todo `bday` est supprimé (HTML `#todoTabs`,
  logique `render`/`renderList`). Nouvelle sous-vue **🎂 Anniversaires** de Contacts (`#contactsSubtabs`,
  `state.contactsSub`, `renderContactsBirthdays` → `upcomingBirthdays`/`birthdayCard`). Toujours affichés
  en **Prochainement** et le jour J en **Aujourd'hui** (inchangés).
- Validé : syntaxe JS OK + tests unitaires de la logique (déplacement de sous-arbre, auto-cochage en
  cascade, tris) via node/`vm`. Commits `322118f`, `aeba796`, `3188dc2`, `f31d8a6`, `70261e8`.

## Sync multi-appareils (lot 12, fait) — ⚠️ SECTION CRITIQUE
**Bug d'origine (signalé par le user, 2 ordinateurs)** : des modifs faites au bureau
n'apparaissaient pas le soir sur le portable, et étaient **définitivement perdues**. Le modèle est
un **document-blob écrit EN ENTIER** (`set`) : sans garde-fous, 4 défauts s'enchaînaient —
(1) rien n'exigeait d'avoir reçu la version **serveur** avant d'écrire → un appareil rouvert avec un
cache périmé écrasait tout le document ; (2) `onSnapshot` **jetait** la donnée distante si une
écriture locale était en attente (`if (_pendingWrite) return`) sans jamais la redemander ;
(3) un snapshot venant du **cache** (`enablePersistence`) était appliqué comme faisant autorité
(pas de test `fromCache` dans la branche « doc existe ») ; (4) les échecs d'écriture étaient
**silencieux** (`console.warn`) → un réseau qui bloque Firestore passait inaperçu.

Invariants à NE PAS casser :
- **Aucune écriture cloud tant que `_serverSynced` est faux** (gardes dans `db.save` ET
  `flushFirestore`). C'est LE garde-fou anti-écrasement. Les modifs attendent dans `localStorage`.
- **Un snapshot `fromCache` ne sert jamais de base d'écriture** (affiché au démarrage, rien de plus).
- **La donnée distante n'est jamais jetée en silence.** On compare une **empreinte** (`hashStr`) :
  `_baseRemote` = version du cloud dont l'état local dérive. Cloud == base → nos modifs sont
  par-dessus, on pousse. Cloud != base + modifs locales → **CONFLIT**.
- **Conflit = on demande** (modale `#syncOverlay`, `openSyncConflict` / `resolveConflictKeepRemote`
  / `resolveConflictKeepLocal`). Jamais de résolution automatique. La version écartée part dans
  `BACKUP_KEY` et est téléchargeable en JSON (`downloadBlob`). Choix user validé (« me demander »).
- **Mémo persisté `SYNCMETA_KEY`** = `{ base, dirty }`. Indispensable : sans lui, des modifs faites
  **hors ligne** seraient prises pour « rien à pousser » au lancement suivant et le cloud les
  écraserait. Relu par `init()` ET `attachSpace()`.
- **Pastille `#syncPill`** (en-tête) : `ok` / `pending` / `waiting` / `local` / `error` via
  `setSyncState`. Rend visible tout échec d'écriture. Ne pas la supprimer « pour épurer ».

Helpers de la couche (source unique de chaque motif — les réutiliser, ne pas réécrire l'enchaînement) :
`markSynced(blobStr)` (aligné sur le cloud : base + dirty + mémo + pastille), `adoptRemote(data)`
(appliquer une version du cloud : état + migrations + cache), `restoreSyncMeta()` (relit le mémo,
appelé par `init` ET `attachSpace`), `cacheLocalBlob()` (seule écriture du cache local),
`writeBackup(blob,tag)` / `backupLocalBlob(tag)`, `downloadBlob(blob,suffix?)` (seul format
d'export ; `exportData` s'appuie dessus), `flushNow()`, `hashStr()`.
⚠️ `adoptRemote` remet le **cache local** d'aplomb : sans ça, l'app réaffichait l'ancienne version
au lancement suivant le temps que le serveur réponde.
- **Menu ⋯ → « Récupérer la sauvegarde locale »** (`offerLocalBackup`) : ressort la copie de secours
  et la **télécharge** (non destructif) au lieu de l'appliquer. Sans ce bouton, le filet existait
  mais restait inaccessible.

Limite assumée : pas de fusion par élément (le blob reste global). Deux appareils modifiant
**en même temps** aboutissent à un conflit tranché par l'utilisateur, pas à une fusion.
Validé par simulation de la couche de sync (15 cas : bug reproduit avant correctif, arrivée des
modifs de l'autre appareil, pas de faux conflit en mono-appareil, hors-ligne poussé à la
reconnexion, vrai conflit signalé). Commit `9c9ae95`.

⚠️ **Piège de diagnostic** : avant de soupçonner la sync, vérifier que les 2 appareils sont sur le
**même espace** (`?espace=pro` vs défaut `perso` = deux documents Firestore totalement distincts)
et le **même compte Google** (`users/{uid}`).

## Règles de collaboration
- **Committer + pusher systématiquement à la fin de chaque lot de modifs** (demande permanente
  du user, 10/06/2026) : il teste directement en ligne après chaque lot. Commit direct sur
  `main` (c'est la branche servie en ligne) — l'ancienne règle « jamais sans demande » est levée.
- Garder un seul `index.html` (pas de fichiers séparés).
