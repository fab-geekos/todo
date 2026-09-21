// Commande « objectifs cloture » (SPEC § 6).
// Toute la clôture est calculée AVANT d'écrire, puis enregistrée (sauvegardes/cloture-en-cours.json).
// Chaque étape vérifie l'état réel avant d'agir : relancer après une interruption reprend là où ça
// s'est arrêté, sans jamais refaire une étape faite ni effacer quoi que ce soit d'inattendu.
import { stop, Abandon } from "./erreurs.js";
import { formatFr, libelleMoisCouvert, decalerMois, jourLocal, jourDe } from "./texte.js";
import { canon, datesDe, texteCanon, reecrireScore, remplacerDate, mentionDate, blocApi, SCORE_RE, parcourir } from "./blocs.js";
import { localiserSections, lireArbre, creerArbre, noeudDe } from "./notion.js";
import { analyserSection } from "./section.js";
import { planifierCloture, appliquerRetrait, verifierMoisUnique, estImportee } from "./regles.js";
import { sauvegarder, planCloture } from "./sauvegardes.js";

const memeArbre = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// Blocs d'archive déjà datés du jour `jour` parmi les enfants de Archives › Dans 1 mois.
const archivesDatees = (noeuds, jour) =>
  noeuds.filter(n => datesDe(n.data.rich_text || []).some(d => jourDe(d.start) === jour));

// Les archives existantes donnent le style du nouveau titre (bloc dépliant, titre dépliant…).
function styleArchive(freres) {
  const dernier = [...freres].reverse().find(n => datesDe(n.data.rich_text || []).length);
  if (dernier && /^heading_[123]$/.test(dernier.type)) return { type: dernier.type, color: dernier.data.color, titre: true };
  return { type: "toggle", color: dernier ? dernier.data.color : undefined };
}

export async function commandeCloture({ notion: N, store, ui, config, maintenant }) {
  ui.titre("Clôture du mois");
  const dossier = config.dossierSauvegardes;
  const { sectionId, archivesId } = await localiserSections(N, config);
  let plan = planCloture.lire(dossier);

  if (plan) {
    ui.avert(`La clôture des objectifs de ${libelleMoisCouvert(plan.date)} a été interrompue : elle va reprendre là où elle s'est arrêtée.`);
    if (!(await ui.demander("Reprendre la clôture ?"))) throw new Abandon();
  } else {
    const noeuds = await lireArbre(N, sectionId);
    const modele = analyserSection(noeuds);
    const date = modele.date;
    const { blob, registre } = await store.lire();

    if (!(blob.tasks || []).some(estImportee) && !(registre.ids || []).length) {
      if (modele.cases.some(c => !c.vide)) stop("Les cases de « Dans 1 mois » n'ont jamais été importées dans l'app.",
        "Lance « objectifs import » (ou « objectifs import --adoption » au tout premier lancement), puis relance.");
      ui.ok("Rien à clôturer : aucun objectif importé. Prochaine étape : écris tes objectifs dans Notion, puis lance « objectifs import ».");
      return;
    }
    verifierMoisUnique(blob, registre, date, "cloture");
    const freres = (await N.enfants(archivesId)).map(noeudDe);
    if (archivesDatees(freres, date).length) stop(`Une archive @${formatFr(date)} existe déjà dans Archives › Dans 1 mois.`,
      "Si elle vient d'une ancienne tentative, supprime-la dans Notion, puis relance.");

    const p = planifierCloture({ noeuds, modele, blob, registre });
    afficherResume(ui, p);
    const aujourdhui = jourLocal(new Date(maintenant));
    if (aujourdhui < date && !(await ui.demander(`La date de revue est le ${formatFr(date)} et on est le ${formatFr(aujourdhui)}. Clôturer quand même ?`)))
      throw new Abandon();
    if (!(await ui.demander("Lancer la clôture ?"))) throw new Abandon();

    const fichier = sauvegarder(dossier, { commande: "cloture", espace: config.espace, blob, notion: noeuds, maintenant });
    plan = { ...p, dateSuivante: decalerMois(date, 1), style: styleArchive(freres), sauvegarde: fichier };
    planCloture.ecrire(dossier, plan);
  }

  await executer({ N, store, ui, plan, sectionId, archivesId });
  planCloture.effacer(dossier);
  afficherBilan(ui, plan);
}

function afficherResume(ui, p) {
  ui.info(`\nObjectifs de ${libelleMoisCouvert(p.date)} (revue le ${formatFr(p.date)}) : ${p.faits}/${p.total} atteints.`);
  if (p.nonFaits.length) { ui.info("\nNon faits :"); p.nonFaits.forEach(t => ui.info(`  ${t}`)); }
  if (p.retirees.length) { ui.info("\nSupprimés dans l'app en cours de mois (absents de l'archive) :"); p.retirees.forEach(t => ui.info(`  ${t}`)); }
  if (p.manuelles.length) { ui.info("\nSous-tâches ajoutées dans l'app (retirées avec leur objectif, non archivées) :"); p.manuelles.forEach(t => ui.info(`  ${t}`)); }
  if (p.avert.length) ui.info("");
  p.avert.forEach(a => ui.avert(a));
  ui.info(`\nCe qui va se passer :`);
  ui.info(`  1. Archive @${formatFr(p.date)} créée dans Archives › Dans 1 mois (score « ${p.faits}/${p.total} : »).`);
  ui.info(`  2. « Dans 1 mois » remis à zéro, daté @${formatFr(decalerMois(p.date, 1))}.`);
  ui.info(`  3. ${p.nbTachesARetirer} tâche(s) retirée(s) de l'app.`);
}

async function executer({ N, store, ui, plan, sectionId, archivesId }) {
  const { date, dateSuivante } = plan;

  // --- Étapes 1-2 : archive, puis relecture ---
  // Avant d'enregistrer le plan, on a vérifié qu'aucune archive de ce mois n'existait : une archive
  // trouvée ici vient donc de CETTE clôture (interrompue, peut-être juste après la création du titre,
  // réponse perdue). Complète → on la garde ; incomplète → corbeille et recréation.
  const archives = archivesDatees((await N.enfants(archivesId)).map(noeudDe), date);
  if (archives.length > 1) stop(`Plusieurs archives @${formatFr(date)} dans Archives › Dans 1 mois.`, "Supprime celle en trop dans Notion, puis relance.");
  let archiveId = null;
  if (archives.length === 1) {
    if (memeArbre(await lireArbre(N, archives[0].id), plan.archive)) archiveId = archives[0].id;
    else { await N.supprimer(archives[0].id); ui.info("Archive incomplète (interruption) : elle est recréée."); }
  }
  if (!archiveId) {
    const data = { rich_text: [mentionDate(date)] };
    if (plan.style.color) data.color = plan.style.color;
    if (plan.style.titre) data.is_toggleable = true;
    const [titre] = await N.ajouter(archivesId, [blocApi({ type: plan.style.type, data })]);
    archiveId = titre.id;
    await creerArbre(N, archiveId, plan.archive);
  }
  if (!memeArbre(await lireArbre(N, archiveId), plan.archive)) stop("L'archive créée ne correspond pas à « Dans 1 mois » : rien n'a été effacé.",
    "Relance « objectifs cloture » : l'archive incomplète sera recréée.");
  ui.ok(`Archive @${formatFr(date)} créée et vérifiée (${plan.faits}/${plan.total}).`);

  // --- Étape 3 : modèle vierge ---
  const noeuds = await lireArbre(N, sectionId);
  const aRetirer = new Set(plan.casesModele);
  for (const n of casesDeTete(noeuds)) if (aRetirer.has(n.id)) await N.supprimer(n.id);
  const score = noeuds.find(n => n.id === plan.scoreNoeudId);
  const ligneDate = noeuds.find(n => n.id === plan.dateNoeudId);
  if (!score || !ligneDate) stop("La ligne de date ou de score de « Dans 1 mois » a disparu pendant la clôture.",
    `Remets-les dans Notion (date @${formatFr(dateSuivante)} et « / : »), puis relance.`);
  const m = texteCanon(score.data.rich_text).match(SCORE_RE);
  if (!m || m[1] !== "" || m[2] !== "") await N.modifier(score.id, score.type, { rich_text: reecrireScore(score.data.rich_text, "/ :") });
  const jours = datesDe(ligneDate.data.rich_text).map(d => jourDe(d.start));
  if (jours.includes(date)) await N.modifier(ligneDate.id, ligneDate.type, { rich_text: remplacerDate(ligneDate.data.rich_text, date, dateSuivante) });
  else if (!jours.includes(dateSuivante)) stop("La date de revue de « Dans 1 mois » a été modifiée pendant la clôture.",
    `Remets la date @${formatFr(dateSuivante)} en tête de « Dans 1 mois », puis relance.`);
  ui.ok(`« Dans 1 mois » remis à zéro, daté @${formatFr(dateSuivante)}.`);

  // --- Étape 4 : retrait des objectifs dans l'app (+ registre vidé), en une opération ---
  let nb = 0;
  await store.transaction(({ blob, registre }) => {
    const r = appliquerRetrait(blob, date);
    nb = r.nb;
    if (!r.nb && !(registre.ids || []).length && !registre.mois) return null;
    return { blob: r.blob, registre: { mois: null, ids: [] } };
  });
  ui.ok(`${nb} tâche(s) retirée(s) de l'app.`);

  // --- Étape 5 : vérification finale ---
  const { blob, registre } = await store.lire();
  const restes = (blob.tasks || []).filter(t => estImportee(t) && t.notion.mois === date);
  const relu = await lireArbre(N, sectionId);
  const problemes = [];
  if (restes.length) problemes.push(`${restes.length} objectif(s) encore dans l'app`);
  if ((registre.ids || []).length) problemes.push("registre des cases importées non vidé");
  if (casesDeTete(relu).some(n => aRetirer.has(n.id))) problemes.push("des cases restent dans « Dans 1 mois »");
  const date2 = relu.find(n => n.id === plan.dateNoeudId);
  if (!date2 || !datesDe(date2.data.rich_text).some(d => jourDe(d.start) === dateSuivante)) problemes.push("date de revue non avancée");
  if (problemes.length) stop(`Vérification après clôture : ${problemes.join(" ; ")}.`, "Relance « objectifs cloture » : elle reprendra là où elle s'est arrêtée.");
}

function afficherBilan(ui, plan) {
  ui.titre(`Bilan de ${libelleMoisCouvert(plan.date)} : ${plan.faits}/${plan.total} atteints`);
  if (plan.nonFaits.length) { ui.info("Non faits :"); plan.nonFaits.forEach(t => ui.info(`  ${t}`)); }
  ui.info(`\nProchaine étape : écris les objectifs de ${libelleMoisCouvert(plan.dateSuivante)} dans « Dans 1 mois », puis lance « objectifs import ».`);
}

// Cases qui ne sont pas sous une autre case (les supprimer emporte leurs sous-cases).
function casesDeTete(noeuds) {
  const out = [];
  parcourir(noeuds, (n, anc) => { if (n.type === "to_do" && !anc.some(a => a.type === "to_do")) out.push(n); });
  return out;
}
