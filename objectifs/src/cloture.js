// Commande « objectifs cloture » (SPEC § 6).
// Toute la clôture est calculée AVANT d'écrire, puis enregistrée (sauvegardes/cloture-en-cours.json).
// Chaque étape vérifie l'état réel avant d'agir : relancer après une interruption reprend là où ça
// s'est arrêté, sans jamais refaire une étape faite ni effacer quoi que ce soit d'inattendu.
import { stop, Abandon } from "./erreurs.js";
import { formatFr, deMois, jourLocal } from "./texte.js";
import { memesArbres, casesDeTete, blocsDates, mentionneJour, lireScore, scoreVaut, reecrireScore,
  remplacerDate, mentionDate, blocApi } from "./blocs.js";
import { localiserSections, lireArbre, creerArbre, noeudDe } from "./notion.js";
import { tous, enAvance } from "./outils.js";
import { sansMesure } from "./chrono.js";
import { analyserSection } from "./section.js";
import { planifierCloture, appliquerRetrait, verifierMoisUnique, aDesImportees, importeesDuMois } from "./regles.js";
import { sauvegarder, planCloture } from "./sauvegardes.js";

const RELANCER = "Relance « objectifs cloture » : elle reprendra là où elle s'est arrêtée.";

export async function commandeCloture({ notion: N, store, ui, config, maintenant, mesure = sansMesure, cache = null }) {
  ui.titre("Clôture du mois");
  const dossier = config.dossierSauvegardes;
  let plan = planCloture.lire(dossier);
  // Lectures en parallèle (rien n'est écrit avant le résumé et le « o »).
  const lectureApp = plan ? null : enAvance(mesure("Lecture de l'app (Firebase)", () => store.lire()));
  const { sectionId, archivesId } = await mesure("Emplacement des sections", () => localiserSections(N, config, { cache }));

  if (plan) {
    ui.avert(`La clôture des objectifs ${deMois(plan.date)} a été interrompue : elle va reprendre là où elle s'est arrêtée.`);
    if (!(await ui.demander("Reprendre la clôture ?"))) throw new Abandon();
  } else {
    const [noeuds, archivesExistantes] = await tous([
      mesure("Lecture de « Dans 1 mois »", () => lireArbre(N, sectionId)),
      mesure("Lecture des archives", async () => (await N.enfants(archivesId)).map(noeudDe))
    ]);
    const modele = analyserSection(noeuds);
    const { blob, registre } = await lectureApp;

    if (!aDesImportees(blob, registre)) {
      if (modele.cases.some(c => !c.vide)) stop("Les cases de « Dans 1 mois » n'ont jamais été importées dans l'app.",
        "Lance « objectifs import » (ou « objectifs import --adoption » au tout premier lancement), puis relance.");
      ui.ok("Rien à clôturer : aucun objectif importé. Prochaine étape : écris tes objectifs dans Notion, puis lance « objectifs import ».");
      return;
    }
    verifierMoisUnique(blob, registre, modele.date, "cloture");
    const p = planifierCloture({ noeuds, modele, blob, registre, archivesExistantes });

    afficherResume(ui, p);
    const aujourdhui = jourLocal(new Date(maintenant));
    if (aujourdhui < p.date && !(await ui.demander(`La date de revue est le ${formatFr(p.date)} et on est le ${formatFr(aujourdhui)}. Clôturer quand même ?`)))
      throw new Abandon();
    if (!(await ui.demander("Lancer la clôture ?"))) throw new Abandon();

    sauvegarder(dossier, { commande: "cloture", espace: config.espace, blob, notion: noeuds, maintenant });
    plan = p;
    planCloture.ecrire(dossier, plan);
  }

  await mesure("Création de l'archive", () => etapeArchive({ N, ui, plan, archivesId }));
  await mesure("Remise à zéro de « Dans 1 mois »", () => etapeModele({ N, ui, plan, sectionId }));
  await mesure("Retrait dans l'app", () => etapeApp({ store, ui, plan }));
  await mesure("Vérification", () => verifierCloture({ N, store, plan, sectionId }));
  planCloture.effacer(dossier);
  afficherBilan(ui, plan);
}

function afficherResume(ui, p) {
  ui.info(`\nObjectifs ${deMois(p.date)} (revue le ${formatFr(p.date)}) : ${p.faits}/${p.total} atteints.`);
  ui.liste("Non faits :", p.nonFaits);
  ui.liste("Supprimés dans l'app en cours de mois (absents de l'archive) :", p.retirees);
  ui.liste("Sous-tâches ajoutées dans l'app (retirées avec leur objectif, non archivées) :", p.manuelles);
  ui.avertissements(p.avert);
  ui.liste("Ce qui va se passer :", [
    `1. Archive @${formatFr(p.date)} créée dans Archives › Dans 1 mois (score « ${p.faits}/${p.total} : »).`,
    `2. « Dans 1 mois » remis à zéro, daté @${formatFr(p.dateSuivante)}.`,
    `3. ${p.nbTachesARetirer} tâche(s) retirée(s) de l'app.`
  ]);
}

function afficherBilan(ui, plan) {
  ui.titre(`Bilan ${deMois(plan.date)} : ${plan.faits}/${plan.total} atteints`);
  ui.liste("Non faits :", plan.nonFaits);
  ui.info(`\nProchaine étape : écris les objectifs ${deMois(plan.dateSuivante)} dans « Dans 1 mois », puis lance « objectifs import ».`);
}

// --- Étape 1 : archive, puis relecture complète ---
// Avant d'enregistrer le plan, on a vérifié qu'aucune archive de ce mois n'existait : une archive
// trouvée ici vient donc de CETTE clôture (interrompue, peut-être juste après la création du titre,
// réponse perdue). Complète → on la garde ; incomplète → corbeille et recréation.
async function etapeArchive({ N, ui, plan, archivesId }) {
  const archives = blocsDates((await N.enfants(archivesId)).map(noeudDe), plan.date);
  if (archives.length > 1) stop(`Plusieurs archives @${formatFr(plan.date)} dans Archives › Dans 1 mois.`, "Supprime celle en trop dans Notion, puis relance.");
  let archiveId = null;
  if (archives.length === 1) {
    if (memesArbres(await lireArbre(N, archives[0].id), plan.archive)) archiveId = archives[0].id;
    else { await N.supprimer(archives[0].id); ui.info("Archive incomplète (interruption) : elle est recréée."); }
  }
  if (!archiveId) {
    const data = { rich_text: [mentionDate(plan.date)] };
    if (plan.style.color) data.color = plan.style.color;
    if (plan.style.titre) data.is_toggleable = true;
    const [titre] = await N.ajouter(archivesId, [blocApi({ type: plan.style.type, data })]);
    archiveId = titre.id;
    await creerArbre(N, archiveId, plan.archive);
  }
  if (!memesArbres(await lireArbre(N, archiveId), plan.archive))
    stop("L'archive créée ne correspond pas à « Dans 1 mois » : rien n'a été effacé.", RELANCER);
  ui.ok(`Archive @${formatFr(plan.date)} créée et vérifiée (${plan.faits}/${plan.total}).`);
}

// --- Étape 2 : modèle vierge. Chaque action vérifie l'état réel (reprise possible) ; elles
// portent sur des blocs différents, donc partent en parallèle. ---
async function etapeModele({ N, ui, plan, sectionId }) {
  const noeuds = await lireArbre(N, sectionId);
  const aRetirer = new Set(plan.casesModele);
  const score = noeuds.find(n => n.id === plan.scoreNoeudId);
  const ligneDate = noeuds.find(n => n.id === plan.dateNoeudId);
  if (!score || !ligneDate) stop("La ligne de date ou de score de « Dans 1 mois » a disparu pendant la clôture.",
    `Remets-les dans Notion (date @${formatFr(plan.dateSuivante)} et « / : »), puis relance.`);
  const dateAvancee = mentionneJour(ligneDate.data.rich_text, plan.dateSuivante);
  if (!dateAvancee && !mentionneJour(ligneDate.data.rich_text, plan.date)) stop("La date de revue de « Dans 1 mois » a été modifiée pendant la clôture.",
    `Remets la date @${formatFr(plan.dateSuivante)} en tête de « Dans 1 mois », puis relance.`);
  await tous([
    ...casesDeTete(noeuds).filter(n => aRetirer.has(n.id)).map(n => N.supprimer(n.id)),
    scoreVaut(lireScore(score.data.rich_text), null, null) ? null
      : N.modifier(score.id, score.type, { rich_text: reecrireScore(score.data.rich_text, null, null) }),
    dateAvancee ? null
      : N.modifier(ligneDate.id, ligneDate.type, { rich_text: remplacerDate(ligneDate.data.rich_text, plan.date, plan.dateSuivante) })
  ]);
  ui.ok(`« Dans 1 mois » remis à zéro, daté @${formatFr(plan.dateSuivante)}.`);
}

// --- Étape 3 : retrait des objectifs dans l'app (+ registre vidé), en une opération ---
async function etapeApp({ store, ui, plan }) {
  let nb = 0;
  await store.transaction(({ blob, registre }) => {
    const r = appliquerRetrait(blob, plan.date);
    nb = r.nb;
    if (!r.nb && !registre.ids.length && !registre.mois) return null;   // déjà fait (reprise)
    return { blob: r.blob, registre: { mois: null, ids: [] } };
  });
  ui.ok(`${nb} tâche(s) retirée(s) de l'app.`);
}

// --- Étape 4 : vérification finale, complète (la clôture efface) ---
async function verifierCloture({ N, store, plan, sectionId }) {
  const [{ blob, registre }, relu] = await tous([store.lire(), lireArbre(N, sectionId)]);
  const aRetirer = new Set(plan.casesModele);
  const restes = importeesDuMois(blob.tasks, plan.date).length;
  const ligneDate = relu.find(n => n.id === plan.dateNoeudId);
  const score = relu.find(n => n.id === plan.scoreNoeudId);
  const problemes = [];
  if (restes) problemes.push(`${restes} objectif(s) encore dans l'app`);
  if (registre.ids.length) problemes.push("registre des cases importées non vidé");
  if (casesDeTete(relu).some(n => aRetirer.has(n.id))) problemes.push("des cases restent dans « Dans 1 mois »");
  if (!ligneDate || !mentionneJour(ligneDate.data.rich_text, plan.dateSuivante)) problemes.push("date de revue non avancée");
  if (!score || !scoreVaut(lireScore(score.data.rich_text), null, null)) problemes.push("ligne de score non remise à zéro");
  if (problemes.length) stop(`Vérification après clôture : ${problemes.join(" ; ")}.`, RELANCER);
}
