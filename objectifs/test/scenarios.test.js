// Scénarios de bout en bout sur un faux Notion et un faux Firestore (aucun accès réseau).
// Les exemples sont fictifs (le dépôt est public).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FauxNotion, FauxStore, FausseUI, toggle, para, gras, todo, image, date, P, dossierTemp } from "./faux.js";
import { adaptateurNotion } from "../src/notion.js";
import { commandeImport } from "../src/import.js";
import { commandeCloture } from "../src/cloture.js";
import { ErreurObjectifs, Abandon } from "../src/erreurs.js";
import { echeanceApp } from "../src/texte.js";

const JOUR = s => new Date(`${s}T10:00:00`).getTime();       // « maintenant » en heure locale

// Page type (SPEC § 4.1) : objectifs de septembre 2026, revue le 01/10/2026.
function pageSeptembre() {
  return [
    toggle("😁 Dev perso", [
      toggle("Objectifs", [
        toggle("Dans 10 ans", [para("Vision")]),
        toggle("Dans 3 mois", [para("Plus tard")]),
        toggle("Dans 1 mois", [
          para(date("2026-10-01")),
          para(" / :"),
          gras("Top priorités"),
          todo(["Finir le dossier A ", P(1)]),
          todo(["Préparer le budget ", P(2)]),
          todo([" Lire le livre B ", P(3)]),
          gras("Culture", [
            todo("Lire le livre B"),
            todo(["Voir l'exposition C ", date("2026-09-15")])
          ]),
          gras("Projets perso", [
            todo("Avancer le projet D", [todo("Étape 1"), todo("Étape 2")])
          ]),
          todo("", [todo("Sous une case vide")]),
          todo("")
        ]),
        toggle("Archives", [
          toggle("Dans 10 ans", []),
          toggle("Dans 1 mois", [
            toggle(date("2026-08-01"), [para("ancien mois")]),
            toggle(date("2026-09-01"), [para("mois dernier")])
          ])
        ])
      ])
    ])
  ];
}

const BLOB = () => ({
  tasks: [{ id: "man1", title: "Acheter du pain", completed: false, projectId: null, parentTaskId: null }],
  projects: [{ id: "pobj", name: "Objectifs du mois", status: "encours" }, { id: "pautre", name: "Autre" }],
  contacts: [], birthDate: null, vaccineDone: null, labels: [], notes: [], mit: { text: "", date: null }
});

function monde({ page = pageSeptembre(), blob = BLOB(), registre } = {}) {
  const faux = new FauxNotion();
  const pageId = faux.page(page);
  const store = new FauxStore(blob, registre);
  const config = {
    notion: { token: "t", page: `https://www.notion.so/Page-${pageId.replace(/-/g, "")}`,
      cheminObjectifs: ["Dev perso", "Objectifs"], section: "Dans 1 mois", cheminArchives: ["Archives", "Dans 1 mois"] },
    espace: "perso", projet: "Objectifs du mois", dossierSauvegardes: dossierTemp()
  };
  const objectifs = faux.trouver("Objectifs");
  const section = faux.trouver("Dans 1 mois", objectifs);
  const archives = faux.trouver("Dans 1 mois", faux.trouver("Archives"));
  return { faux, store, config, section, archives, N: adaptateurNotion(faux) };
}

const lancerImport = (m, reponses, opts = {}) => {
  const ui = new FausseUI(reponses, opts);
  return commandeImport({ notion: m.N, store: m.store, ui, config: m.config, maintenant: opts.maintenant || JOUR("2026-09-03"), adoption: !!opts.adoption }).then(() => ui);
};
const lancerCloture = (m, reponses, opts = {}) => {
  const ui = new FausseUI(reponses, opts);
  return commandeCloture({ notion: m.N, store: m.store, ui, config: m.config, maintenant: opts.maintenant || JOUR("2026-10-02") }).then(() => ui);
};
const importees = store => store.blob.tasks.filter(t => t.notion);
const tache = (store, titre) => store.blob.tasks.find(t => t.title === titre);
const texteScore = m => m.faux.dump(m.section).find(x => typeof x === "string" && x.includes(":"));
async function rejette(promesse, extrait) {
  await assert.rejects(promesse, e => {
    assert.ok(e instanceof ErreurObjectifs, `ErreurObjectifs attendue, reçu : ${e && e.stack}`);
    if (extrait) assert.match(e.message + " " + (e.conseil || ""), extrait);
    return true;
  });
}

/* ================= IMPORT ================= */

test("import : objectifs, priorités, sous-objectifs, échéance, doublons, cases vides", async () => {
  const m = monde();
  const ui = await lancerImport(m, ["o"]);
  const t = importees(m.store);
  assert.deepEqual(t.map(x => x.title), ["Finir le dossier A", "Préparer le budget", "Lire le livre B",
    "Voir l'exposition C", "Avancer le projet D", "Étape 1", "Étape 2", "Sous une case vide"]);
  const A = tache(m.store, "Finir le dossier A"), B = tache(m.store, "Lire le livre B"), D = tache(m.store, "Avancer le projet D");
  assert.deepEqual([A.important, A.urgent], [true, true]);                         // P1 → Faire
  assert.deepEqual([tache(m.store, "Préparer le budget").important, tache(m.store, "Préparer le budget").urgent], [true, false]);
  assert.deepEqual([B.important, B.urgent], [false, true]);                        // P3 → Si possible
  assert.equal(B.notion.ids.length, 2);                                            // 2 cases, 1 tâche
  assert.deepEqual([D.important, D.urgent], [false, false]);                       // P4
  assert.equal(tache(m.store, "Voir l'exposition C").dueDate, echeanceApp("2026-09-15"));
  assert.equal(tache(m.store, "Étape 1").parentTaskId, D.id);
  assert.equal(tache(m.store, "Sous une case vide").parentTaskId, null);           // case vide « effacée »
  assert.ok(t.every(x => x.projectId === "pobj" && x.notion.mois === "2026-10-01" && !x.completed && x.recurrence === null));
  assert.ok(t.every(x => Object.values(x).every(v => v !== undefined)));
  assert.equal(tache(m.store, "Acheter du pain").notion, undefined);               // tâche manuelle intacte
  assert.equal(m.store.registre.mois, "2026-10-01");
  assert.equal(m.store.registre.ids.length, 9);                                    // 9 cases pleines
  assert.equal(texteScore(m), "¶ /8 :");
  assert.equal(readdirSync(m.config.dossierSauvegardes).length, 2);                // app + Notion
  assert.match(ui.texte, /P3 · Lire le livre B {2}\(2 cases fusionnées\)/);
  assert.match(ui.texte, /Voir l'exposition C {2}\(échéance 15\/09\/2026\)/);
});

test("import relancé : rien de nouveau, puis seules les cases ajoutées sont créées", async () => {
  const m = monde();
  await lancerImport(m, ["o"]);
  const ecritures = m.store.ecritures;
  const ui = await lancerImport(m, []);                                            // aucune question posée
  assert.match(ui.texte, /Rien de nouveau : les 8 objectifs/);
  assert.equal(m.store.ecritures, ecritures);

  m.faux.ajouterSous(m.faux.trouver("Culture"), [todo("Écouter l'album E")]);
  m.faux.ajouterSous(m.faux.trouver("Avancer le projet D"), [todo("Étape 3")]);
  m.faux.ajouterSous(m.faux.trouver("Top priorités"), [todo(["Avancer le projet D ", P(2)])],
    { apres: m.faux.trouver("Préparer le budget") });                              // doublon ajouté après coup
  const ui2 = await lancerImport(m, ["o"]);
  assert.match(ui2.texte, /À créer dans l'app \(2\)/);
  assert.equal(importees(m.store).length, 10);
  assert.equal(tache(m.store, "Étape 3").parentTaskId, tache(m.store, "Avancer le projet D").id);
  assert.equal(tache(m.store, "Avancer le projet D").notion.ids.length, 2);        // case ajoutée à l'étiquette
  assert.equal(texteScore(m), "¶ /10 :");
});

test("import : « n » = rien n'est écrit", async () => {
  const m = monde();
  await assert.rejects(lancerImport(m, ["n"]), Abandon);
  assert.equal(m.store.ecritures, 0);
  assert.equal(texteScore(m), "¶  / :");
  assert.equal(existsSync(m.config.dossierSauvegardes) ? readdirSync(m.config.dossierSauvegardes).length : 0, 0);
});

test("import : clôture oubliée (objectifs d'un autre mois encore dans l'app)", async () => {
  const blob = BLOB();
  blob.tasks.push({ id: "x", title: "Vieux", projectId: "pobj", notion: { ids: ["zz"], mois: "2026-09-01" } });
  const m = monde({ blob, registre: { mois: "2026-09-01", ids: ["zz"] } });
  await rejette(lancerImport(m, ["o"]), /objectifs cloture/);
  assert.equal(m.store.ecritures, 0);
});

test("import : erreurs de structure (niveaux, projet, date, score, chemin)", async () => {
  const quatre = pageSeptembre();
  quatre[0].enfants[0].enfants[2].enfants.push(todo("N1", [todo("N2", [todo("N3", [todo("N4")])])]));
  await rejette(lancerImport(monde({ page: quatre }), ["o"]), /niveau 4/);

  const sansProjet = BLOB(); sansProjet.projects = [];
  await rejette(lancerImport(monde({ blob: sansProjet }), ["o"]), /Projet « Objectifs du mois » introuvable/);
  const double = BLOB(); double.projects.push({ id: "p2", name: "objectifs du mois" });
  await rejette(lancerImport(monde({ blob: double }), ["o"]), /2 projets/);

  const pasPremier = pageSeptembre();
  pasPremier[0].enfants[0].enfants[2].enfants[0] = para(date("2026-10-02"));
  await rejette(lancerImport(monde({ page: pasPremier }), ["o"]), /pas un 1er du mois/);

  const sansScore = pageSeptembre();
  sansScore[0].enfants[0].enfants[2].enfants.splice(1, 1);
  await rejette(lancerImport(monde({ page: sansScore }), ["o"]), /Ligne de score/);

  const renomme = pageSeptembre();
  renomme[0].enfants[0].enfants[2] = toggle("Ce mois-ci", []);
  await rejette(lancerImport(monde({ page: renomme }), ["o"]), /Dans 1 mois/);
});

test("import : l'app modifiée pendant l'aperçu → rien n'est écrit", async () => {
  const m = monde();
  const ui = lancerImport(m, ["o"], { pendantQuestion: () => {
    m.store.blob.projects.push({ id: "p3", name: "Objectifs du mois" });           // projet dupliqué entre-temps
  } });
  await rejette(ui, /2 projets/);
  const m2 = monde();
  await lancerImport(m2, ["o"]);
  const m3 = monde();
  await rejette(lancerImport(m3, ["o"], { pendantQuestion: () => {
    m3.store.blob.tasks.push({ ...importees(m2.store)[0] });                         // un autre import est passé
    m3.store.registre = { ...m2.store.registre };
  } }), /modifiée pendant l'aperçu/);
  assert.equal(m3.store.ecritures, 0);
});

test("import : titres proches signalés, mention non-date gardée dans le titre", async () => {
  const page = pageSeptembre();
  page[0].enfants[0].enfants[2].enfants.push(todo("Relire le compte rendu"), todo("Relire le compte-rendu"),
    todo(["Voir ", { pageMention: "11111111-1111-4111-8111-111111111111" }]));
  const m = monde({ page });
  const ui = await lancerImport(m, ["o"]);
  assert.match(ui.texte, /se ressemblent/);
  assert.ok(tache(m.store, "Voir Une page"));
});

/* ================= CLÔTURE ================= */

// Un mois « vécu » dans l'app : cochées, supprimée, sous-tâche ajoutée à la main.
async function moisVecu() {
  const m = monde();
  await lancerImport(m, ["o"]);
  const s = m.store.blob;
  for (const titre of ["Finir le dossier A", "Lire le livre B", "Étape 1"]) Object.assign(s.tasks.find(t => t.title === titre), { completed: true, completedAt: 1 });
  s.tasks = s.tasks.filter(t => t.title !== "Préparer le budget");
  s.tasks.push({ id: "man2", title: "Appeler Y", completed: false, projectId: "pobj", parentTaskId: tache(m.store, "Avancer le projet D").id });
  s.tasks.push({ id: "man3", title: "Tâche libre du projet", completed: true, projectId: "pobj", parentTaskId: null });
  return m;
}

const ARCHIVE_ATTENDUE = [
  "¶ @2026-10-01",
  "¶ 3/7 :",
  "¶ **Top priorités",
  "☑ Finir le dossier A P1",
  "☑  Lire le livre B P3",
  { "¶ **Culture": ["☑ Lire le livre B", "☐ Voir l'exposition C @2026-09-15"] },
  { "¶ **Projets perso": [{ "☐ Avancer le projet D": ["☑ Étape 1", "☐ Étape 2"] }] },
  { "☐ ": ["☐ Sous une case vide"] },
  "☐ "
];

test("clôture : archive fidèle, modèle vierge, objectifs retirés de l'app", async () => {
  const m = await moisVecu();
  const ui = await lancerCloture(m, ["o"]);
  const archives = m.faux.dump(m.archives);
  assert.deepEqual(archives.map(a => Object.keys(a)[0] || a), ["▸ @2026-08-01", "▸ @2026-09-01", "▸ @2026-10-01"]);
  assert.deepEqual(archives[2]["▸ @2026-10-01"], ARCHIVE_ATTENDUE);
  assert.deepEqual(m.faux.dump(m.section), ["¶ @2026-11-01", "¶ / :", "¶ **Top priorités", "¶ **Culture", "¶ **Projets perso"]);
  assert.deepEqual(m.store.blob.tasks.map(t => t.title), ["Acheter du pain", "Tâche libre du projet"]);
  assert.deepEqual(m.store.registre, { mois: null, ids: [] });
  assert.ok(!existsSync(join(m.config.dossierSauvegardes, "cloture-en-cours.json")));
  assert.match(ui.texte, /3\/7 atteints/);
  assert.match(ui.texte, /Supprimés dans l'app en cours de mois[^\n]*\n {2}Préparer le budget/);
  assert.match(ui.texte, /Sous-tâches ajoutées dans l'app[^\n]*\n {2}Appeler Y/);
  assert.match(ui.texte, /Bilan de septembre 2026 : 3\/7 atteints/);
  assert.equal(ui.questions.length, 1);                                            // pas de question « date »
  // La corbeille Notion garde les cases retirées (récupérables).
  assert.ok([...m.faux.blocs.values()].some(b => b.in_trash && b.type === "to_do"));
});

test("clôture : case jamais importée → arrêt, rien n'est touché", async () => {
  const m = await moisVecu();
  m.faux.ajouterSous(m.faux.trouver("Culture"), [todo("Ajoutée après l'import")]);
  const avant = JSON.stringify(m.faux.dump(m.faux.trouver("Objectifs")));
  await rejette(lancerCloture(m, ["o"]), /Ajoutée après l'import/);
  assert.equal(JSON.stringify(m.faux.dump(m.faux.trouver("Objectifs"))), avant);
  assert.equal(importees(m.store).length, 7);
});

test("clôture : avant la date de revue, confirmation demandée", async () => {
  const m = await moisVecu();
  await assert.rejects(lancerCloture(m, ["n"], { maintenant: JOUR("2026-09-25") }), Abandon);
  assert.equal(importees(m.store).length, 7);
  const ui = await lancerCloture(m, ["o", "o"], { maintenant: JOUR("2026-09-25") });
  assert.match(ui.questions[0], /01\/10\/2026 et on est le 25\/09\/2026/);
  assert.equal(importees(m.store).length, 0);
  // En retard (le 7 du mois) : aucune question supplémentaire.
  const m2 = await moisVecu();
  const ui2 = await lancerCloture(m2, ["o"], { maintenant: JOUR("2026-10-07") });
  assert.equal(ui2.questions.length, 1);
});

test("clôture : rien à clôturer / bloc non recopiable / archive déjà présente", async () => {
  const modeleVierge = pageSeptembre();
  modeleVierge[0].enfants[0].enfants[2].enfants = [para(date("2026-10-01")), para("/ :"), gras("Top priorités")];
  const ui = await lancerCloture(monde({ page: modeleVierge }), []);
  assert.match(ui.texte, /Rien à clôturer/);

  const nonImporte = monde();
  await rejette(lancerCloture(nonImporte, ["o"]), /jamais été importées/);

  const m = await moisVecu();
  m.faux.ajouterSous(m.section, [image()]);
  await rejette(lancerCloture(m, ["o"]), /image/);

  const m2 = await moisVecu();
  m2.faux.ajouterSous(m2.archives, [toggle(date("2026-10-01"), [para("à la main")])]);
  await rejette(lancerCloture(m2, ["o"]), /existe déjà/);
  assert.equal(importees(m2.store).length, 7);
});

// Reprise : pour chaque point de panne, 1er lancement interrompu puis relance → même résultat
// qu'une clôture sans incident.
const PANNES = [
  { nom: "création du titre d'archive (réponse perdue)", notion: { methode: "append", n: 1, apres: true } },
  { nom: "remplissage de l'archive (avant envoi)", notion: { methode: "append", n: 3 } },
  { nom: "remplissage de l'archive (réponse perdue)", notion: { methode: "append", n: 4, apres: true } },
  { nom: "retrait des cases du modèle", notion: { methode: "delete", n: 2 } },
  { nom: "remise à zéro du score", notion: { methode: "update", n: 1 } },
  { nom: "avance de la date (réponse perdue)", notion: { methode: "update", n: 2, apres: true } },
  { nom: "retrait dans l'app", store: true }
];
for (const panne of PANNES) {
  test(`clôture : reprise après une coupure pendant « ${panne.nom} »`, async () => {
    const m = await moisVecu();
    if (panne.notion) { m.faux.panne = { ...panne.notion }; m.faux.appels = { list: 0, append: 0, update: 0, delete: 0 }; }
    if (panne.store) m.store.panne = true;
    await assert.rejects(lancerCloture(m, ["o"]), /simulé/);
    assert.ok(existsSync(join(m.config.dossierSauvegardes, "cloture-en-cours.json")));
    const ui = await lancerCloture(m, ["o"]);
    assert.match(ui.questions[0], /Reprendre la clôture/);
    const archives = m.faux.dump(m.archives);
    assert.equal(archives.length, 3, JSON.stringify(archives));
    assert.deepEqual(archives[2]["▸ @2026-10-01"], ARCHIVE_ATTENDUE);
    assert.deepEqual(m.faux.dump(m.section), ["¶ @2026-11-01", "¶ / :", "¶ **Top priorités", "¶ **Culture", "¶ **Projets perso"]);
    assert.deepEqual(m.store.blob.tasks.map(t => t.title), ["Acheter du pain", "Tâche libre du projet"]);
    assert.ok(!existsSync(join(m.config.dossierSauvegardes, "cloture-en-cours.json")));
  });
}

/* ================= ADOPTION ET CYCLE COMPLET ================= */

test("cycle complet : adoption → clôture → nouveaux objectifs → import → clôture", async () => {
  const blob = BLOB();
  blob.tasks.push(
    { id: "s1", title: "Finir le dossier A", completed: true, completedAt: 5, projectId: "pobj", parentTaskId: null, important: false, urgent: false },
    { id: "s2", title: "avancer le projet D", completed: false, projectId: "pobj", parentTaskId: null },
    { id: "s3", title: "Étape 1", completed: true, projectId: "pobj", parentTaskId: "s2" },
    { id: "s4", title: "Tâche perso libre", completed: false, projectId: "pobj", parentTaskId: null }
  );
  const m = monde({ blob });

  // Sans --adoption, les homonymes sont signalés (réponse « n »).
  const ui0 = new FausseUI(["n"]);
  await assert.rejects(commandeImport({ notion: m.N, store: m.store, ui: ui0, config: m.config, maintenant: JOUR("2026-09-21") }), Abandon);
  assert.match(ui0.texte, /--adoption/);

  const ui = await lancerImport(m, ["o"], { adoption: true, maintenant: JOUR("2026-09-21") });
  assert.match(ui.texte, /Adoptées[^\n]*\(3\)/);
  assert.match(ui.texte, /sans case Notion correspondante[^\n]*\n {2}Tâche perso libre/);
  const A = m.store.blob.tasks.find(t => t.id === "s1");
  assert.deepEqual([A.completed, A.important, A.urgent, A.notion.mois], [true, true, true, "2026-10-01"]);
  assert.equal(m.store.blob.tasks.find(t => t.id === "s3").notion.mois, "2026-10-01");
  assert.equal(tache(m.store, "Étape 2").parentTaskId, "s2");                      // créée sous la tâche adoptée
  assert.equal(m.store.blob.tasks.find(t => t.id === "s4").notion, undefined);
  assert.equal(importees(m.store).length, 8);
  await rejette(lancerImport(m, [], { adoption: true }), /déjà été faite/);

  // Clôture de septembre.
  await lancerCloture(m, ["o"], { maintenant: JOUR("2026-10-01") });
  const sept = m.faux.dump(m.archives)[2]["▸ @2026-10-01"];
  // Faits : A (déjà cochée avant l'adoption) et Étape 1 → 2 sur 8.
  assert.ok(sept.includes("☑ Finir le dossier A P1") && sept.includes("¶ 2/8 :"), JSON.stringify(sept));
  assert.deepEqual(m.store.blob.tasks.map(t => t.title), ["Acheter du pain", "Tâche perso libre"]);

  // Import sans avoir écrit d'objectifs : rien à faire (le score « /0 : » est quand même posé).
  // Fabien écrit octobre dans le modèle vierge.
  m.faux.ajouterSous(m.section, [todo(["Courir 3 fois par semaine ", P(1)])], { apres: m.faux.trouver("Top priorités") });
  m.faux.ajouterSous(m.faux.trouver("Culture"), [todo("Lire le livre F", [todo("Chapitres 1 à 5")])]);
  await lancerImport(m, ["o"], { maintenant: JOUR("2026-10-03") });
  assert.deepEqual(importees(m.store).map(t => [t.title, t.notion.mois]),
    [["Courir 3 fois par semaine", "2026-11-01"], ["Lire le livre F", "2026-11-01"], ["Chapitres 1 à 5", "2026-11-01"]]);
  assert.equal(texteScore(m), "¶ /3 :");

  tache(m.store, "Chapitres 1 à 5").completed = true;
  await lancerCloture(m, ["o"], { maintenant: JOUR("2026-11-04") });
  const archives = m.faux.dump(m.archives);
  assert.deepEqual(archives.map(a => Object.keys(a)[0]), ["▸ @2026-08-01", "▸ @2026-09-01", "▸ @2026-10-01", "▸ @2026-11-01"]);
  assert.deepEqual(archives[3]["▸ @2026-11-01"], ["¶ @2026-11-01", "¶ 1/3 :", "¶ **Top priorités", "☐ Courir 3 fois par semaine P1",
    { "¶ **Culture": [{ "☐ Lire le livre F": ["☑ Chapitres 1 à 5"] }] }, "¶ **Projets perso"]);
  assert.deepEqual(m.faux.dump(m.section)[0], "¶ @2026-12-01");
  // 3 lancements avec écriture (adoption, import, 2 clôtures) : seules les 2 dernières sauvegardes restent.
  const fichiers = readdirSync(m.config.dossierSauvegardes);
  assert.equal(fichiers.length, 4, fichiers.join(", "));
  assert.ok(fichiers.every(f => f.includes("cloture") || f.includes("import")));
});

test("adoption : deux tâches au même titre → arrêt", async () => {
  const blob = BLOB();
  blob.tasks.push({ id: "d1", title: "Finir le dossier A", projectId: "pobj", parentTaskId: null },
    { id: "d2", title: "Finir le dossier A ", projectId: "pobj", parentTaskId: null });
  await rejette(lancerImport(monde({ blob }), ["o"], { adoption: true }), /Plusieurs tâches « Finir le dossier A »/);
});
