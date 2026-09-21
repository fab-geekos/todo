// Règles métier, sans accès réseau (testées directement). Vocabulaire :
// - « case » : une case à cocher Notion ;
// - « unité » : un objectif ou sous-objectif = UNE tâche dans l'app (plusieurs cases au même texte
//   = une seule unité, SPEC § 4.2) ;
// - « étiquette » : champ `notion: { ids, mois }` posé sur la tâche importée (SPEC § 5.2).
// Le blob lu par le store a toujours `tasks` (tableau) et le registre toujours `ids` (tableau).
import { stop } from "./erreurs.js";
import { SEUIL_RESSEMBLANCE } from "./parametres.js";
import { cle, extrairePriorite, similarite, echeanceApp, formatFr, decalerMois } from "./texte.js";
import { chargeDe, reecrireScore, casesDeTete, blocsDates, datesDe } from "./blocs.js";

// Priorité Notion → drapeaux de l'app (SPEC § 5.1). Sans priorité (sous-objectif) = P4.
const FLAGS = { 1: { important: true, urgent: true }, 2: { important: true, urgent: false },
  3: { important: false, urgent: true }, 4: { important: false, urgent: false } };
export const drapeaux = prio => FLAGS[prio || 4];

/* ---------- Cases → unités ---------- */

export function construireUnites(cases) {
  const avert = [];
  const racines = [];
  const parCase = new Map();                        // id de case → unité
  const racineParCle = new Map();
  const nouvelle = (c, parent) => ({ ids: [c.id], titre: c.titre, cle: c.cle, prio: null, echeance: c.echeance,
    parent, enfants: [], enfantsParCle: new Map() });

  const pleines = cases.filter(c => !c.vide);
  // Passe 1 : les objectifs (cases sans case parente). Même texte = même unité.
  for (const c of pleines.filter(c => !c.parentId)) {
    let u = racineParCle.get(c.cle);
    if (u) u.ids.push(c.id);
    else { u = nouvelle(c, null); racineParCle.set(c.cle, u); racines.push(u); }
    fusionnerAttributs(u, c, avert);
    parCase.set(c.id, u);
  }
  // Passe 2 : les sous-objectifs, dans l'ordre du document (un parent précède toujours ses enfants).
  // La profondeur (≤ NIVEAUX_MAX) est déjà garantie par la lecture de la section : les fusions ne
  // peuvent que la réduire.
  for (const c of pleines.filter(c => c.parentId)) {
    const racine = racineParCle.get(c.cle);
    if (racine) {
      // Même texte qu'un objectif (ex. mis en avant dans Top priorités) : rattaché à l'objectif.
      racine.ids.push(c.id);
      fusionnerAttributs(racine, c, avert);
      parCase.set(c.id, racine);
      avert.push(`« ${c.titre} » est aussi un sous-objectif : il est fusionné avec l'objectif du même nom (une seule tâche, avec sa priorité).`);
      continue;
    }
    const parent = parCase.get(c.parentId);
    let u = parent.enfantsParCle.get(c.cle);
    if (u) u.ids.push(c.id);
    else { u = nouvelle(c, parent); parent.enfantsParCle.set(c.cle, u); parent.enfants.push(u); }
    if (c.prio) avert.push(`Priorité P${c.prio} ignorée sur le sous-objectif « ${c.titre} » (seuls les objectifs ont une priorité).`);
    parCase.set(c.id, u);
  }
  for (const u of racines) if (!u.prio) u.prio = 4;  // priorité par défaut : P4 (SPEC § 4.2)

  // Ressemblances suspectes (doublon involontaire ?) : signalées, pas bloquantes. Des titres qui ne
  // diffèrent que par un numéro (« Étape 1 » / « Étape 2 ») sont une numérotation, pas un doublon.
  const toutes = aplatir(racines).map(x => x.unite);
  const sansNumeros = s => cle(s).replace(/\d+/g, "#");
  for (let i = 0; i < toutes.length; i++) for (let j = i + 1; j < toutes.length; j++) {
    const [a, b] = [toutes[i].titre, toutes[j].titre];
    if (sansNumeros(a) !== sansNumeros(b) && similarite(a, b) >= SEUIL_RESSEMBLANCE)
      avert.push(`« ${a} » et « ${b} » se ressemblent : doublon involontaire ?`);
  }
  return { racines, avert };
}

function fusionnerAttributs(u, c, avert) {
  if (c.prio) {
    if (u.prio && u.prio !== c.prio) avert.push(`« ${u.titre} » a deux priorités (P${u.prio} et P${c.prio}) : P${Math.min(u.prio, c.prio)} est retenue.`);
    u.prio = u.prio ? Math.min(u.prio, c.prio) : c.prio;
  }
  if (c.echeance) {
    if (u.echeance && u.echeance.jour !== c.echeance.jour) {
      avert.push(`« ${u.titre} » a deux échéances : la plus proche est retenue.`);
      if (c.echeance.jour < u.echeance.jour) u.echeance = c.echeance;
    } else if (!u.echeance) u.echeance = c.echeance;
  }
}

// Unités dans l'ordre d'affichage (parent puis enfants) avec leur niveau.
export function aplatir(racines) {
  const out = [];
  const visiter = (u, niveau) => { out.push({ unite: u, niveau }); u.enfants.forEach(e => visiter(e, niveau + 1)); };
  racines.forEach(u => visiter(u, 1));
  return out;
}

/* ---------- Lecture de l'app ---------- */

export function trouverProjet(blob, nom) {
  const trouves = (blob.projects || []).filter(p => cle(p.name) === cle(nom));
  if (trouves.length === 0) stop(`Projet « ${nom} » introuvable dans l'espace perso de l'app.`, "Crée le projet dans l'app (ou corrige son nom), puis relance.");
  if (trouves.length > 1) stop(`Il y a ${trouves.length} projets « ${nom} » dans l'app.`, "Renomme ou supprime le projet en trop, puis relance.");
  return trouves[0];
}

const estImportee = t => !!(t && t.notion && Array.isArray(t.notion.ids));
export const importeesDuMois = (taches, mois) => taches.filter(t => estImportee(t) && t.notion.mois === mois);

// L'app ou le registre contiennent-ils des objectifs importés (quel que soit le mois) ?
export const aDesImportees = (blob, registre) => blob.tasks.some(estImportee) || registre.ids.length > 0;

// Cases déjà importées pour le mois `date` (d'après le registre).
export const idsImportes = (registre, date) => new Set(registre.mois === date ? registre.ids : []);

// id de case Notion → tâche importée du mois `mois`.
export function indexEtiquettes(taches, mois) {
  const index = new Map();
  for (const t of importeesDuMois(taches, mois)) for (const id of t.notion.ids) index.set(id, t);
  return index;
}

// Garde-fou commun : l'app ne doit contenir que des objectifs du mois `date` (SPEC § 3).
export function verifierMoisUnique(blob, registre, date, commande) {
  const autre = blob.tasks.filter(estImportee).map(t => t.notion.mois).find(m => m !== date)
    || (registre.mois && registre.mois !== date && registre.ids.length ? registre.mois : null);
  if (!autre) return;
  if (commande === "import") stop(`L'app contient encore les objectifs datés @${formatFr(autre)}, alors que Notion est daté @${formatFr(date)}.`,
    "Clôture oubliée ? Lance d'abord « objectifs cloture ».");
  stop(`L'app contient des objectifs datés @${formatFr(autre)}, mais « Dans 1 mois » est daté @${formatFr(date)}.`,
    "La date de revue a peut-être été modifiée dans Notion. Remets la date du mois en cours, puis relance.");
}

/* ---------- Import ---------- */

let _seq = 0;
// Identifiant au format de l'app (cf. uid() dans index.html), garanti unique dans le blob.
function nouvelId(existants, maintenant) {
  let id;
  do { id = maintenant.toString(36) + (++_seq).toString(36) + Math.random().toString(36).slice(2, 5); }
  while (existants.has(id));
  existants.add(id);
  return id;
}

// Calcule ce que l'import va faire, à partir de l'état de l'app. Pur : rejoué à l'identique dans la
// transaction pour vérifier que l'app n'a pas bougé entre l'aperçu et l'écriture.
// Renvoie { creations, etiquetages, adoptions, supprimees, orphelines, nonAdoptees, homonymes, total, registre }.
export function planifierImport({ unites, blob, registre, projet, date, adoption }) {
  const dejaImportes = idsImportes(registre, date);
  const index = indexEtiquettes(blob.tasks, date);
  const ordre = aplatir(unites.racines).map(x => x.unite);
  const plan = { creations: [], etiquetages: [], adoptions: [], supprimees: [], orphelines: [], nonAdoptees: [], homonymes: [] };
  const tacheDe = new Map();                         // unité → { id } (tâche existante ou adoptée) ou { creation }

  // Adoption : tâches du projet pas encore étiquetées, rangées par parent.
  const duProjet = blob.tasks.filter(t => t.projectId === projet.id && !estImportee(t));
  const idsProjet = new Set(duProjet.map(t => t.id));
  const enfantsDe = pid => duProjet.filter(t => (pid ? t.parentTaskId === pid : !t.parentTaskId || !idsProjet.has(t.parentTaskId)));
  const adoptees = new Set();
  const cleTache = t => cle(extrairePriorite(t.title).titre);

  for (const u of ordre) {
    const existante = u.ids.map(id => index.get(id)).find(Boolean);
    if (existante) {                                   // déjà importée : on complète l'étiquette si besoin
      const manquants = u.ids.filter(id => !existante.notion.ids.includes(id));
      if (manquants.length) plan.etiquetages.push({ tacheId: existante.id, ids: manquants, titre: u.titre });
      tacheDe.set(u, { id: existante.id });
      continue;
    }
    if (u.ids.some(id => dejaImportes.has(id))) {     // importée puis supprimée dans l'app : on respecte
      plan.supprimees.push(u.titre);
      continue;
    }
    const parent = u.parent ? tacheDe.get(u.parent) : null;
    // Adoption : cherchée parmi les racines du projet, ou sous la tâche EXISTANTE du parent
    // (un parent tout juste créé n'a évidemment pas d'enfants à adopter).
    const parentExistant = parent && parent.id;
    if (adoption && (!u.parent || parentExistant)) {
      const candidates = enfantsDe(u.parent ? parentExistant : null).filter(t => !adoptees.has(t.id) && cleTache(t) === u.cle);
      if (candidates.length > 1) stop(`Plusieurs tâches « ${u.titre} » au même endroit du projet : impossible de savoir laquelle adopter.`,
        "Supprime ou renomme les doublons dans l'app, puis relance « objectifs import --adoption ».");
      if (candidates.length === 1) {
        const t = candidates[0];
        adoptees.add(t.id);
        plan.adoptions.push({ tacheId: t.id, ids: [...u.ids], prio: u.parent ? null : u.prio, echeance: u.echeance, titre: t.title });
        tacheDe.set(u, { id: t.id });
        continue;
      }
    }
    if (u.parent && !parent) plan.orphelines.push(u.titre);   // parent absent → devient une tâche normale
    const creation = { unite: u, parentRef: parent || null, prio: parent ? null : (u.parent ? 4 : u.prio) };
    plan.creations.push(creation);
    tacheDe.set(u, { creation });
  }

  if (adoption) plan.nonAdoptees = duProjet.filter(t => !adoptees.has(t.id)).map(t => t.title);
  else if (!dejaImportes.size) {
    // Premier import sans --adoption alors que le projet contient déjà ces titres → doublons probables.
    const cles = new Set(ordre.map(u => u.cle));
    plan.homonymes = duProjet.filter(t => cles.has(cleTache(t))).map(t => t.title);
  }

  plan.registre = { mois: date, ids: [...new Set([...dejaImportes, ...ordre.flatMap(u => u.ids)])] };
  plan.total = new Set(index.values()).size + plan.creations.length + plan.adoptions.length;
  return plan;
}

// Empreinte d'un plan d'import (ce que Fabien a validé) : doit être identique au moment d'écrire.
export function empreintePlan(plan) {
  return JSON.stringify({
    c: plan.creations.map(c => [c.unite.ids, c.parentRef ? (c.parentRef.id || "nouv") : null]),
    e: plan.etiquetages.map(e => [e.tacheId, e.ids]),
    a: plan.adoptions.map(a => [a.tacheId, a.ids])
  });
}

// Applique un plan d'import au blob (copie) → nouveau blob. Les tâches créées vont en fin de liste,
// dans l'ordre de Notion (l'app affiche les sous-tâches dans l'ordre du tableau).
export function appliquerImport(blob, plan, { projet, date, maintenant }) {
  const taches = blob.tasks.map(t => ({ ...t }));
  const parId = new Map(taches.map(t => [t.id, t]));
  const existants = new Set(parId.keys());
  const idCree = new Map();                          // unité → id de la tâche créée
  const echeance = e => ({ dueDate: e ? echeanceApp(e.jour) : null, dueTime: e ? e.heure : null });

  for (const e of plan.etiquetages) {
    const t = parId.get(e.tacheId);
    t.notion = { ...t.notion, ids: [...t.notion.ids, ...e.ids] };
  }
  for (const a of plan.adoptions) {
    const t = parId.get(a.tacheId);
    t.notion = { ids: a.ids, mois: date };
    if (a.prio) Object.assign(t, drapeaux(a.prio));
    if (a.echeance) Object.assign(t, echeance(a.echeance));
  }
  for (const c of plan.creations) {
    const u = c.unite;
    const id = nouvelId(existants, maintenant);
    idCree.set(u, id);
    taches.push({
      id,
      title: u.titre,
      note: "",
      ...echeance(u.echeance),
      ...drapeaux(c.prio),
      completed: false,
      createdAt: maintenant,
      projectId: projet.id,
      parentTaskId: c.parentRef ? (c.parentRef.id || idCree.get(c.parentRef.creation.unite)) : null,
      recurrence: null,
      notion: { ids: [...u.ids], mois: date }
    });
  }
  return { ...blob, tasks: taches };
}

/* ---------- Clôture ---------- */

// Ids des objectifs importés du mois `date` ET de toute leur descendance (sous-tâches manuelles comprises).
function idsARetirer(taches, date) {
  const out = new Set(importeesDuMois(taches, date).map(t => t.id));
  let ajout = true;
  while (ajout) {
    ajout = false;
    for (const t of taches) if (t.parentTaskId && out.has(t.parentTaskId) && !out.has(t.id)) { out.add(t.id); ajout = true; }
  }
  return out;
}

// Les archives existantes donnent le style du nouveau titre (bloc dépliant, titre dépliant…).
function styleArchive(archivesExistantes) {
  const derniere = [...archivesExistantes].reverse().find(n => datesDe(n.data.rich_text).length);
  if (derniere && /^heading_[123]$/.test(derniere.type)) return { type: derniere.type, color: derniere.data.color, titre: true };
  return { type: "toggle", color: derniere ? derniere.data.color : undefined };
}

// Prépare toute la clôture, avant la moindre écriture. Le plan est enregistré sur le disque : si la
// clôture est interrompue, la reprise se fait sur CE plan (la page Notion a pu être déjà vidée).
// `archivesExistantes` = enfants de Archives › Dans 1 mois.
export function planifierCloture({ noeuds, modele, blob, registre, archivesExistantes }) {
  const date = modele.date;
  const index = indexEtiquettes(blob.tasks, date);
  const importes = idsImportes(registre, date);
  const avert = [];

  if (modele.nonCopiables.length) stop(`« Dans 1 mois » contient un bloc impossible à recopier (${modele.nonCopiables.join(", ")}).`,
    "Retire ce bloc (ou remplace-le par du texte), puis relance.");
  const pleines = modele.cases.filter(c => !c.vide);
  const jamais = pleines.filter(c => !importes.has(c.id));
  if (jamais.length) stop(`Case(s) jamais importée(s) dans l'app : ${jamais.map(c => `« ${c.titre} »`).join(", ")}.`,
    "Lance « objectifs import », ou supprime la case dans Notion, puis relance « objectifs cloture ».");
  if (blocsDates(archivesExistantes, date).length) stop(`Une archive @${formatFr(date)} existe déjà dans Archives › Dans 1 mois.`,
    "Si elle vient d'une ancienne tentative, supprime-la dans Notion, puis relance.");

  // Statut de chaque case : cochée (true) / non cochée (false) / supprimée dans l'app (null).
  const statut = new Map(pleines.map(c => [c.id, index.has(c.id) ? !!index.get(c.id).completed : null]));

  // Score : une tâche = une unité (les cases fusionnées comptent une fois).
  const presentes = new Map();                       // tâche → titre Notion de sa 1re case
  for (const c of pleines) if (index.has(c.id) && !presentes.has(index.get(c.id))) presentes.set(index.get(c.id), c.titre);
  const faits = [...presentes.keys()].filter(t => t.completed).length;
  const total = presentes.size;

  // Copie fidèle de la section : cases mises à jour, cases supprimées dans l'app retirées,
  // ligne de score remplie avec le score final. Une case vide disparaît et ses sous-cases
  // remontent d'un niveau (choix de Fabien, 21/09/2026).
  const vides = new Set(modele.cases.filter(c => c.vide).map(c => c.id));
  const copier = liste => liste.flatMap(n => {
    if (statut.get(n.id) === null) return [];
    if (vides.has(n.id)) return copier(n.enfants);
    const data = chargeDe(n, m => avert.push(m));
    if (statut.has(n.id)) data.checked = statut.get(n.id);
    if (n === modele.scoreNoeud) data.rich_text = reecrireScore(n.data.rich_text, faits, total);
    return [{ type: n.type, data, enfants: copier(n.enfants) }];
  });

  const disparues = [...new Set(index.values())].filter(t => !presentes.has(t)).map(t => `« ${t.title} »`);
  if (disparues.length) avert.push(`Tâche(s) importée(s) dont la case a disparu de Notion (retirées de l'app, absentes de l'archive) : ${disparues.join(", ")}.`);

  const aRetirer = idsARetirer(blob.tasks, date);
  const supprimee = id => statut.get(id) === null;
  return {
    date,
    dateSuivante: decalerMois(date, 1),
    archive: copier(noeuds),
    style: styleArchive(archivesExistantes),
    faits, total,
    nonFaits: [...presentes].filter(([t]) => !t.completed).map(([, titre]) => titre),
    retirees: pleines.filter(c => supprimee(c.id) && !supprimee(c.parentId)).map(c => c.titre),
    manuelles: blob.tasks.filter(t => aRetirer.has(t.id) && !estImportee(t)).map(t => t.title),
    nbTachesARetirer: aRetirer.size,
    casesModele: casesDeTete(noeuds).map(n => n.id),
    dateNoeudId: modele.dateNoeud.id,
    scoreNoeudId: modele.scoreNoeud.id,
    avert
  };
}

// Retire du blob tous les objectifs du mois `date` (et leur descendance) → { blob, nb }.
export function appliquerRetrait(blob, date) {
  const ids = idsARetirer(blob.tasks, date);
  return { blob: { ...blob, tasks: blob.tasks.filter(t => !ids.has(t.id)) }, nb: ids.size };
}
