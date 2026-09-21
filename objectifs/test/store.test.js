// Tests de l'accès direct à Firestore (API REST) sur un faux serveur : conversion des valeurs,
// jeton signé, transactions, reprises, erreurs, et un cycle import + clôture complet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { versChamps, depuisChamps, versFirestore, creerStore } from "../src/store.js";
import { ErreurObjectifs } from "../src/erreurs.js";
import { FauxFirestore, fichierCleTest } from "./faux-firestore.js";
import { FauxNotion, FausseUI, toggle, para, gras, todo, date, P, dossierTemp } from "./faux.js";
import { adaptateurNotion } from "../src/notion.js";
import { commandeImport } from "../src/import.js";
import { commandeCloture } from "../src/cloture.js";

const CLE = fichierCleTest();
const BLOB = () => ({
  tasks: [{ id: "man1", title: "Acheter du pain « bio » 🥖", completed: false, createdAt: 1789990726446, dueDate: null,
    parentTaskId: null, projectId: null, note: "", ratio: 0.5, labels: [], vide: {}, sous: { a: [1, "x", true, null] } }],
  projects: [{ id: "pobj", name: "Objectifs du mois" }],
  contacts: [], birthDate: null, vaccineDone: null, labels: [], notes: [], mit: { text: "", date: null }
});
const cacheMemoire = () => { const d = {}; return { d, lire: k => d[k], ecrire: (k, v) => { d[k] = v; } }; };
const ouvrir = (serveur, extra = {}) => creerStore({ cleService: CLE, email: "fabien@exemple.org", espace: "perso", fetch: serveur.fetch, ...extra });

test("conversion JS ⇄ Firestore : aller-retour exact, mêmes types que l'app", () => {
  const blob = BLOB();
  const champs = versChamps({ ...blob, indefini: undefined });
  assert.equal(champs.indefini, undefined);                                         // ignoré, comme dans l'app
  const t = champs.tasks.arrayValue.values[0].mapValue.fields;
  assert.deepEqual(t.createdAt, { integerValue: "1789990726446" });                 // entier → integerValue
  assert.deepEqual(t.ratio, { doubleValue: 0.5 });
  assert.deepEqual(t.labels, { arrayValue: {} });
  assert.deepEqual(t.vide, { mapValue: {} });
  assert.deepEqual(t.dueDate, { nullValue: null });
  assert.deepEqual(depuisChamps(JSON.parse(JSON.stringify(champs))), blob);         // passage par le réseau (JSON)
  // Une valeur d'un type que l'app n'écrit pas (horodatage) est réécrite à l'identique.
  const brut = { quand: { timestampValue: "2026-01-01T00:00:00Z" }, ref: { referenceValue: "projects/p/databases/(default)/documents/a/b" } };
  assert.deepEqual(versChamps(depuisChamps(brut)), brut);
  assert.throws(() => versFirestore(() => 1));
});

test("store : jeton signé, identifiant mémorisé, lecture", async () => {
  const serveur = new FauxFirestore();
  serveur.poser("users/uid-1/spaces/perso", { ...versChamps(BLOB()), _v: { integerValue: "1" }, _updatedAt: { timestampValue: "2026-09-01T00:00:00Z" } });
  const cache = cacheMemoire();
  const store = await ouvrir(serveur, { cache });
  assert.equal(serveur.appels.jeton, 1);
  assert.equal(serveur.appels.lookup, 1);
  assert.deepEqual(cache.d.firebase, { email: "fabien@exemple.org", uid: "uid-1" });
  const { blob, registre } = await store.lire();
  assert.equal(blob._updatedAt, undefined);                                         // horodatage serveur retiré
  assert.equal(blob.tasks[0].title, "Acheter du pain « bio » 🥖");
  assert.deepEqual(registre, { mois: null, ids: [] });
  await ouvrir(serveur, { cache });
  assert.equal(serveur.appels.lookup, 1);                                           // identifiant pris dans le mémo
  await assert.rejects(ouvrir(serveur, { email: "inconnu@exemple.org" }), /introuvable/);
  await assert.rejects((await ouvrir(serveur, { espace: "absent" })).lire(), /Espace introuvable/);
});

test("store : transaction = deux documents écrits d'un coup, au format de l'app", async () => {
  const serveur = new FauxFirestore();
  serveur.poser("users/uid-1/spaces/perso", versChamps(BLOB()));
  const store = await ouvrir(serveur);
  const ok = await store.transaction(({ blob }) => ({ blob: { ...blob, tasks: [...blob.tasks, { id: "n1", title: "Nouveau" }] }, registre: { mois: "2026-10-01", ids: ["c1"] } }));
  assert.equal(ok, true);
  const espace = serveur.champs("users/uid-1/spaces/perso");
  assert.deepEqual(espace._v, { integerValue: "1" });
  assert.ok(espace._updatedAt.timestampValue);                                      // posé par le serveur
  assert.deepEqual(depuisChamps(espace).tasks.map(t => t.title), ["Acheter du pain « bio » 🥖", "Nouveau"]);
  assert.deepEqual(depuisChamps(serveur.champs("users/uid-1/objectifs/perso")).ids, ["c1"]);
  // Rien à écrire : transaction annulée, aucun commit.
  const commits = serveur.appels.commit;
  assert.equal(await store.transaction(() => null), false);
  assert.equal(serveur.appels.commit, commits);
  assert.equal(serveur.appels.annulation, 1);
});

test("store : conflit ou coupure → la transaction est rejouée (relue et recalculée)", async () => {
  const serveur = new FauxFirestore();
  serveur.poser("users/uid-1/spaces/perso", versChamps(BLOB()));
  const store = await ouvrir(serveur);
  serveur.pannes.push({ etape: "commit", statut: 409, status: "ABORTED" }, { etape: "debut", reseau: true }, { etape: "lecture", statut: 503, status: "UNAVAILABLE" });
  let calculs = 0;
  await store.transaction(({ blob }) => { calculs++; return { blob: { ...blob, mit: { text: "ok", date: null } }, registre: { mois: null, ids: [] } }; });
  assert.equal(calculs, 2);                                                         // 1er calcul perdu (conflit), 2e écrit
  assert.equal(depuisChamps(serveur.champs("users/uid-1/spaces/perso")).mit.text, "ok");
});

test("store : erreur métier ou refus d'accès → jamais rejoué", async () => {
  const serveur = new FauxFirestore();
  serveur.poser("users/uid-1/spaces/perso", versChamps(BLOB()));
  const store = await ouvrir(serveur);
  let calculs = 0;
  await assert.rejects(store.transaction(() => { calculs++; throw new ErreurObjectifs("plan modifié"); }), /plan modifié/);
  assert.equal(calculs, 1);
  serveur.pannes.push({ etape: "commit", statut: 403, status: "PERMISSION_DENIED" });
  await assert.rejects(store.transaction(({ blob, registre }) => ({ blob, registre })), /refuse l'accès/);
  assert.equal(serveur.appels.commit, 1);
  const refus = new FauxFirestore();
  refus.pannes.push({ etape: "jeton", statut: 400 });
  await assert.rejects(ouvrir(refus), /Firebase a répondu 400/);
});

test("cycle import + clôture sur le faux serveur Firestore (accès direct)", async () => {
  const serveur = new FauxFirestore();
  serveur.poser("users/uid-1/spaces/perso", versChamps(BLOB()));
  const faux = new FauxNotion();
  const pageId = faux.page([toggle("Dev perso", [toggle("Objectifs", [
    toggle("Dans 1 mois", [para(date("2026-10-01")), para("/ :"), gras("Top priorités"), todo(["Finir le dossier A ", P(1)]),
      todo("Avancer le projet D", [todo("Étape 1")])]),
    toggle("Archives", [toggle("Dans 1 mois", [])])])])]);
  const config = { notion: { token: "t", page: pageId, cheminObjectifs: ["Dev perso", "Objectifs"], section: "Dans 1 mois", cheminArchives: ["Archives", "Dans 1 mois"] },
    espace: "perso", projet: "Objectifs du mois", dossierSauvegardes: dossierTemp() };
  const store = await ouvrir(serveur);
  const N = adaptateurNotion(faux);
  await commandeImport({ notion: N, store, ui: new FausseUI(["o"]), config, maintenant: new Date("2026-09-03T10:00:00").getTime() });
  let blob = depuisChamps(serveur.champs("users/uid-1/spaces/perso"));
  assert.deepEqual(blob.tasks.filter(t => t.notion).map(t => [t.title, t.important, t.urgent]),
    [["Finir le dossier A", true, true], ["Avancer le projet D", false, false], ["Étape 1", false, false]]);
  blob.tasks.find(t => t.title === "Étape 1").completed = true;
  serveur.poser("users/uid-1/spaces/perso", versChamps(blob));                        // cochée dans l'app
  await commandeCloture({ notion: N, store, ui: new FausseUI(["o"]), config, maintenant: new Date("2026-10-02T10:00:00").getTime() });
  blob = depuisChamps(serveur.champs("users/uid-1/spaces/perso"));
  assert.deepEqual(blob.tasks.map(t => t.title), ["Acheter du pain « bio » 🥖"]);
  assert.deepEqual(depuisChamps(serveur.champs("users/uid-1/objectifs/perso")), { mois: null, ids: [], _updatedAt: blob._updatedAt ?? depuisChamps(serveur.champs("users/uid-1/objectifs/perso"))._updatedAt });
  const archive = faux.dump(faux.trouver("Dans 1 mois", faux.trouver("Archives")))[0];
  assert.deepEqual(archive["▸ @2026-10-01"], ["¶ @2026-10-01", "¶ 1/3 :", "¶ **Top priorités", "☐ Finir le dossier A P1", { "☐ Avancer le projet D": ["☑ Étape 1"] }]);
});
