// Tests des fonctions pures (texte, dates, texte enrichi, fusion des cases).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cle, cleChemin, extrairePriorite, similarite, decalerMois, formatFr, libelleMoisCouvert, deMois,
  estPremierDuMois, heureDe, echeanceApp } from "../src/texte.js";
import { reecrireScore, lireScore, scoreVaut, remplacerDate, nettoyerTexte, texteCanon, texteSansDates } from "../src/blocs.js";
import { construireUnites, drapeaux } from "../src/regles.js";
import { ErreurObjectifs } from "../src/erreurs.js";

const txt = (content, annotations = {}) => ({ type: "text", text: { content, link: null }, annotations, plain_text: content, href: null });
const mention = start => ({ type: "mention", mention: { type: "date", date: { start, end: null, time_zone: null } }, annotations: {}, plain_text: start, href: null });

test("priorité en fin de ligne", () => {
  assert.deepEqual(extrairePriorite("Finir le dossier A P1"), { titre: "Finir le dossier A", prio: 1 });
  assert.deepEqual(extrairePriorite(" Relire le compte rendu  P3 "), { titre: "Relire le compte rendu", prio: 3 });
  assert.deepEqual(extrairePriorite("Lire le livre B"), { titre: "Lire le livre B", prio: null });
  assert.deepEqual(extrairePriorite("Voir le film P1X"), { titre: "Voir le film P1X", prio: null });
  assert.deepEqual(extrairePriorite("SP2"), { titre: "SP2", prio: null });
  assert.deepEqual(extrairePriorite("P2"), { titre: "", prio: 2 });
});

test("clés de comparaison", () => {
  assert.equal(cle("  Lire  le Livre B "), "lire le livre b");
  assert.equal(cleChemin("😁 Dev perso"), "dev perso");
  assert.equal(cleChemin("Dans 1 mois"), "dans 1 mois");
  assert.ok(similarite("Relire le compte rendu", "Relire le compte-rendu") >= 0.8);
  assert.ok(similarite("Lire le livre B", "Préparer le budget") < 0.8);
});

test("dates", () => {
  assert.equal(decalerMois("2026-12-01", 1), "2027-01-01");
  assert.equal(decalerMois("2026-01-01", -1), "2025-12-01");
  assert.equal(formatFr("2026-10-01"), "01/10/2026");
  assert.equal(libelleMoisCouvert("2026-10-01"), "septembre 2026");
  assert.equal(libelleMoisCouvert("2027-01-01"), "décembre 2026");
  assert.equal(deMois("2026-10-01"), "de septembre 2026");
  assert.equal(deMois("2026-11-01"), "d'octobre 2026");
  assert.equal(deMois("2026-09-01"), "d'août 2026");
  assert.equal(deMois("2026-05-01"), "d'avril 2026");
  assert.ok(estPremierDuMois("2026-10-01"));
  assert.ok(!estPremierDuMois("2026-10-02"));
  assert.equal(heureDe("2026-10-15T14:30:00.000+02:00"), "14:30");
  assert.equal(heureDe("2026-10-15"), null);
  const d = new Date(echeanceApp("2026-09-15"));
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 8, 15, 0]);
});

test("ligne de score : réécrite sans toucher la suite", () => {
  const rt = [txt(" / :", { bold: true }), txt(" ma note")];
  const r = reecrireScore(rt, null, 8);
  assert.equal(texteCanon(r), "/8 : ma note");
  assert.equal(r[0].annotations.bold, true);
  assert.equal(texteCanon(reecrireScore([txt("6/9 : bravo")], null, null)), "/ : bravo");
  assert.equal(texteCanon(reecrireScore([txt("/"), txt(" 9 "), txt(": fin")], 3, 9)), "3/9 : fin");
  assert.throws(() => reecrireScore([txt("pas de score")], null, null), ErreurObjectifs);
  assert.deepEqual(lireScore([txt(" / : note")]), { faits: null, total: null });
  assert.deepEqual(lireScore([txt("6/9 :")]), { faits: 6, total: 9 });
  assert.equal(lireScore([txt("Top priorités")]), null);
  assert.ok(scoreVaut(lireScore([txt("/9 :")]), null, 9));
  assert.ok(!scoreVaut(lireScore([txt("0/9 :")]), null, 9));
  assert.ok(!scoreVaut(null, null, null));
});

test("texte enrichi : nettoyage pour l'API, dates", () => {
  const rt = [txt("Voir l'expo "), mention("2026-09-15"), txt(" P2")];
  assert.equal(texteSansDates(rt).replace(/\s+/g, " ").trim(), "Voir l'expo P2");
  const propre = nettoyerTexte(rt);
  assert.ok(propre.every(it => !("plain_text" in it) && !("href" in it)));
  assert.deepEqual(propre[1].mention, { date: { start: "2026-09-15", end: null } });
  const avance = remplacerDate([mention("2026-10-01")], "2026-10-01", "2026-11-01");
  assert.equal(avance[0].mention.date.start, "2026-11-01");
  const avert = [];
  const lien = nettoyerTexte([{ type: "mention", mention: { type: "link_preview", link_preview: { url: "https://x.org" } }, plain_text: "https://x.org", href: "https://x.org", annotations: {} }], m => avert.push(m));
  assert.equal(lien[0].type, "text");
  assert.equal(lien[0].text.link.url, "https://x.org");
  assert.equal(avert.length, 1);
});

const cas = (id, titre, { prio = null, parentId = null, vide = false, echeance = null } = {}) =>
  ({ id, titre, cle: cle(titre), prio, parentId, vide, echeance });

test("unités : doublons fusionnés, priorité par défaut P4, sous-objectifs", () => {
  const u = construireUnites([
    cas("a", "Finir A", { prio: 1 }),
    cas("b", "Lire B", { prio: 3 }),
    cas("b2", "lire  b"),
    cas("d", "Projet D"),
    cas("d1", "Étape 1", { parentId: "d" }),
    cas("d1bis", "Étape 1", { parentId: "d" }),
    cas("e", "Projet E"),
    cas("e1", "Étape 1", { parentId: "e" })
  ]);
  assert.equal(u.racines.length, 4);
  const b = u.racines[1];
  assert.deepEqual(b.ids, ["b", "b2"]);
  assert.equal(b.prio, 3);
  assert.equal(u.racines[2].prio, 4);
  assert.deepEqual(u.racines[2].enfants[0].ids, ["d1", "d1bis"]);       // même parent : fusion
  assert.deepEqual(u.racines[3].enfants[0].ids, ["e1"]);                // autre parent : distinct
});

test("unités : sous-objectif mis en avant dans Top priorités → fusionné avec l'objectif", () => {
  const u = construireUnites([
    cas("t", "Continuer l'archipel", { prio: 1 }),
    cas("p", "Continuer le transfert"),
    cas("p1", "Continuer l'archipel", { parentId: "p" })
  ]);
  assert.deepEqual(u.racines[0].ids, ["t", "p1"]);
  assert.equal(u.racines[1].enfants.length, 0);
  assert.ok(u.avert.some(a => a.includes("aussi un sous-objectif")));
});

test("unités : priorités contradictoires, ressemblances", () => {
  const u = construireUnites([cas("a", "Lire B", { prio: 2 }), cas("b", "Lire B", { prio: 1 }),
    cas("c", "Relire le compte rendu"), cas("d", "Relire le compte-rendu")]);
  assert.equal(u.racines[0].prio, 1);
  assert.ok(u.avert.some(a => a.includes("deux priorités")));
  assert.ok(u.avert.some(a => a.includes("se ressemblent")));
  const numeros = construireUnites([cas("p", "Projet"), cas("e1", "Étape 1", { parentId: "p" }), cas("e2", "Étape 2", { parentId: "p" })]);
  assert.ok(!numeros.avert.some(a => a.includes("se ressemblent")));
});

test("priorités → drapeaux de l'app", () => {
  assert.deepEqual(drapeaux(1), { important: true, urgent: true });
  assert.deepEqual(drapeaux(2), { important: true, urgent: false });
  assert.deepEqual(drapeaux(3), { important: false, urgent: true });
  assert.deepEqual(drapeaux(4), { important: false, urgent: false });
  assert.deepEqual(drapeaux(null), { important: false, urgent: false });
});
