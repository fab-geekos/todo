// Commande « objectifs import » (SPEC § 7) et son mode « --adoption » (§ 7.1).
import { stop, Abandon } from "./erreurs.js";
import { formatFr, deMois } from "./texte.js";
import { reecrireScore, texteCanon, SCORE_RE } from "./blocs.js";
import { localiserSections, lireArbre } from "./notion.js";
import { analyserSection } from "./section.js";
import { construireUnites, aplatir, trouverProjet, planifierImport, empreintePlan, appliquerImport,
  verifierMoisUnique, moisPresents, indexEtiquettes } from "./regles.js";
import { sauvegarder } from "./sauvegardes.js";

export async function commandeImport({ notion: N, store, ui, config, maintenant, adoption = false }) {
  ui.titre(adoption ? "Import des objectifs (premier lancement : adoption)" : "Import des objectifs");
  const { sectionId } = await localiserSections(N, config, { archives: false });
  const noeuds = await lireArbre(N, sectionId);
  const modele = analyserSection(noeuds);
  const date = modele.date;
  ui.info(`Objectifs ${deMois(date)} (revue le ${formatFr(date)})`);

  const { blob, registre } = await store.lire();
  const projet = trouverProjet(blob, config.projet);
  if (adoption && (moisPresents(blob.tasks || []).length || (registre.ids || []).length))
    stop("L'adoption a déjà été faite : l'app contient déjà des objectifs importés.", "Lance « objectifs import » sans --adoption.");
  verifierMoisUnique(blob, registre, date, "import");

  const unites = construireUnites(modele.cases);
  const plan = planifierImport({ unites, blob, registre, projet, date, adoption });
  const scoreOk = modele.score.faits === null && modele.score.total === plan.total;
  const registreAvant = new Set(registre.mois === date ? registre.ids || [] : []);
  const registreChange = registre.mois !== date || plan.registre.ids.some(id => !registreAvant.has(id));
  const tachesChangent = plan.creations.length || plan.etiquetages.length || plan.adoptions.length;

  if (!tachesChangent && !registreChange && scoreOk) {
    unites.avert.forEach(a => ui.avert(a));
    ui.ok(`Rien de nouveau : les ${plan.total} objectifs de Notion sont déjà dans l'app.`);
    return;
  }

  afficherApercu(ui, { plan, unites, adoption, score: `/${plan.total} :` });
  const question = adoption && plan.nonAdoptees.length
    ? "Les tâches non reconnues resteront des tâches manuelles. Écrire dans l'app et dans Notion ?"
    : "Écrire dans l'app et dans Notion ?";
  if (!(await ui.demander(question))) throw new Abandon();

  const fichier = sauvegarder(config.dossierSauvegardes, { commande: "import", espace: config.espace, blob, notion: noeuds, maintenant });

  // Écriture atomique. Le plan est recalculé sur l'état FRAIS de l'app : s'il diffère de l'aperçu
  // (modif faite dans l'app entre-temps), on n'écrit rien.
  const empreinte = empreintePlan(plan);
  await store.transaction(({ blob: frais, registre: regFrais }) => {
    const projetFrais = trouverProjet(frais, config.projet);
    verifierMoisUnique(frais, regFrais, date, "import");
    const planFrais = planifierImport({ unites, blob: frais, registre: regFrais, projet: projetFrais, date, adoption });
    if (empreintePlan(planFrais) !== empreinte) stop("L'app a été modifiée pendant l'aperçu : rien n'a été écrit.", "Relance « objectifs import ».");
    return { blob: appliquerImport(frais, planFrais, { projet: projetFrais, date, maintenant }), registre: planFrais.registre };
  });
  if (!scoreOk) {
    await N.modifier(modele.scoreNoeud.id, modele.scoreNoeud.type,
      { rich_text: reecrireScore(modele.scoreNoeud.data.rich_text, `/${plan.total} :`) });
  }

  await verifierImport({ N, store, sectionId, unites, plan, date, fichier });
  ui.ok(`${plan.total} objectifs ${deMois(date)} dans l'app, score « /${plan.total} : » écrit dans Notion.`);
}

function afficherApercu(ui, { plan, unites, adoption, score }) {
  const niveau = new Map(aplatir(unites.racines).map(x => [x.unite, x.niveau]));
  const creees = new Set(plan.creations.map(c => c.unite));
  const ligne = (u, prio) => {
    const n = niveau.get(u);
    const tete = n === 1 || prio ? `  P${prio || 4} · ` : `${"      ".repeat(n - 1)}  └ `;
    // Sous-objectif dont le parent existe déjà dans l'app : on nomme le parent (sinon il semblerait
    // rangé sous la ligne précédente de la liste).
    const sous = !prio && u.parent && !creees.has(u.parent) ? `sous « ${u.parent.titre} »` : "";
    const details = [sous, u.ids.length > 1 ? `${u.ids.length} cases fusionnées` : "",
      u.echeance ? `échéance ${formatFr(u.echeance.jour)}${u.echeance.heure ? " " + u.echeance.heure : ""}` : ""].filter(Boolean);
    return tete + u.titre + (details.length ? `  (${details.join(", ")})` : "");
  };
  const bloc = (titre, lignes) => { if (lignes.length) { ui.info(`\n${titre}`); lignes.forEach(l => ui.info(l)); } };
  bloc(`À créer dans l'app (${plan.creations.length}) :`, plan.creations.map(c => ligne(c.unite, c.prio)));
  bloc(`Adoptées (déjà dans l'app, reconnues) (${plan.adoptions.length}) :`, plan.adoptions.map(a => `  ${a.prio ? "P" + a.prio + " · " : "  └ "}${a.titre}`));
  bloc("Déjà importées, cases ajoutées :", plan.etiquetages.map(e => `  ${e.titre}`));
  bloc("Supprimées dans l'app, pas recréées :", plan.supprimees.map(t => `  ${t}`));
  bloc("Sans objectif parent dans l'app (deviennent des tâches normales) :", plan.orphelines.map(t => `  ${t}`));
  if (adoption) bloc("Tâches du projet sans case Notion correspondante (resteront des tâches manuelles, jamais touchées) :",
    plan.nonAdoptees.map(t => `  ${t}`));
  if (plan.homonymes.length) ui.avert(`Le projet contient déjà des tâches au même titre (${plan.homonymes.map(t => `« ${t} »`).join(", ")}). Premier lancement ? Réponds « n » et utilise « objectifs import --adoption ».`);
  if (unites.avert.length) ui.info("");
  unites.avert.forEach(a => ui.avert(a));
  ui.info(`\nScore écrit dans Notion : « ${score} »`);
}

// Relit l'app et Notion : tout doit correspondre exactement au plan (SPEC § 7, étape 8).
async function verifierImport({ N, store, sectionId, unites, plan, date, fichier }) {
  const { blob, registre } = await store.lire();
  const index = indexEtiquettes(blob.tasks || [], date);
  const problemes = [];
  const supprimees = new Set(plan.supprimees);
  for (const { unite: u } of aplatir(unites.racines)) {
    const t = index.get(u.ids[0]);
    if (!t) { if (!supprimees.has(u.titre)) problemes.push(`« ${u.titre} » absente de l'app`); continue; }
    if (u.ids.some(id => index.get(id) !== t)) problemes.push(`« ${u.titre} » : cases mal rattachées`);
    const parent = u.parent && index.get(u.parent.ids[0]);
    if (parent && t.parentTaskId !== parent.id) problemes.push(`« ${u.titre} » n'est pas sous « ${u.parent.titre} »`);
  }
  if (new Set(index.values()).size !== plan.total) problemes.push(`${new Set(index.values()).size} tâches importées au lieu de ${plan.total}`);
  const reg = new Set(registre.ids || []);
  if (registre.mois !== date || plan.registre.ids.some(id => !reg.has(id))) problemes.push("registre des cases importées incomplet");
  const scoreLu = (await lireArbre(N, sectionId)).find(n => n.type !== "to_do" && SCORE_RE.test(texteCanon(n.data.rich_text || [])));
  const m = scoreLu && texteCanon(scoreLu.data.rich_text).match(SCORE_RE);
  if (!m || m[1] !== "" || Number(m[2]) !== plan.total) problemes.push("score Notion incorrect");
  if (problemes.length) stop(`Vérification après import : ${problemes.join(" ; ")}.`,
    `Relance « objectifs import » (il ne recrée rien de ce qui existe). Sauvegarde de l'app avant import : ${fichier}`);
}
