// Règles métier, sans accès réseau (testées directement). Vocabulaire :
// - « case » : une case à cocher Notion ;
// - « unité » : un objectif ou sous-objectif = UNE tâche dans l'app (plusieurs cases au même texte
//   = une seule unité, SPEC § 4.2) ;
// - « étiquette » : champ `notion: { ids, mois }` posé sur la tâche importée (SPEC § 5.2).
import { stop } from "./erreurs.js";
import { cle, extrairePriorite, similarite, echeanceApp, formatFr } from "./texte.js";
import { chargeDe, reecrireScore, parcourir } from "./blocs.js";

export const MAX_NIVEAUX = 3;                      // = MAX_TASK_DEPTH de l'app
export const SEUIL_RESSEMBLANCE = 0.8;

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
  // Priorité par défaut : P4 (SPEC § 4.2).
  for (const u of racines) if (!u.prio) u.prio = 4;
  // Profondeur finale ≤ 3 niveaux.
  const verifier = (u, niveau) => {
    if (niveau > MAX_NIVEAUX) stop(`« ${u.titre} » arrive au niveau ${niveau} : l'app accepte ${MAX_NIVEAUX} niveaux au maximum.`,
      "Remonte cette case d'un niveau dans Notion, puis relance.");
    u.enfants.forEach(e => verifier(e, niveau + 1));
  };
  racines.forEach(u => verifier(u, 1));
  // Ressemblances suspectes (doublon involontaire ?) : signalées, pas bloquantes. Des titres qui ne
  // diffèrent que par un numéro (« Étape 1 » / « Étape 2 ») sont une numérotation, pas un doublon.
  const toutes = aplatir(racines).map(x => x.unite);
  const sansNumeros = s => cle(s).replace(/\d+/g, "#");
  for (let i = 0; i < toutes.length; i++) for (let j = i + 1; j < toutes.length; j++) {
    if (sansNumeros(toutes[i].titre) === sansNumeros(toutes[j].titre)) continue;
    if (similarite(toutes[i].titre, toutes[j].titre) >= SEUIL_RESSEMBLANCE)
      avert.push(`« ${toutes[i].titre} » et « ${toutes[j].titre} » se ressemblent : doublon involontaire ?`);
  }
  return { racines, parCase, avert };
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

export const estImportee = t => !!(t && t.notion && Array.isArray(t.notion.ids));

// id de case Notion → tâche importée (du mois donné si précisé).
export function indexEtiquettes(taches, mois = null) {
  const index = new Map();
  for (const t of taches) {
    if (!estImportee(t) || (mois && t.notion.mois !== mois)) continue;
    for (const id of t.notion.ids) index.set(id, t);
  }
  return index;
}

// Mois (dates de revue) des tâches importées encore présentes.
export const moisPresents = taches => [...new Set(taches.filter(estImportee).map(t => t.notion.mois))];

// Garde-fou commun : l'app ne doit contenir que des objectifs du mois `date` (SPEC § 3).
export function verifierMoisUnique(blob, registre, date, commande) {
  const autres = moisPresents(blob.tasks || []).filter(m => m !== date);
  const regAutre = registre.mois && registre.mois !== date && (registre.ids || []).length;
  if (autres.length || regAutre) {
    const m = autres[0] || registre.mois;
    if (commande === "import") stop(`L'app contient encore les objectifs datés @${formatFr(m)}, alors que Notion est daté @${formatFr(date)}.`,
      "Clôture oubliée ? Lance d'abord « objectifs cloture ».");
    stop(`L'app contient des objectifs datés @${formatFr(m)}, mais « Dans 1 mois » est daté @${formatFr(date)}.`,
      "La date de revue a peut-être été modifiée dans Notion. Remets la date du mois en cours, puis relance.");
  }
}

/* ---------- Import ---------- */

let _seq = 0;
// Identifiant au format de l'app (cf. uid() dans index.html), garanti unique dans le blob.
export function nouvelId(existants, maintenant) {
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
  const taches = blob.tasks || [];
  const idsDejaImportes = new Set(registre.mois === date ? registre.ids || [] : []);
  const index = indexEtiquettes(taches, date);
  const plan = { creations: [], etiquetages: [], adoptions: [], supprimees: [], orphelines: [], nonAdoptees: [], homonymes: [] };
  const tacheDe = new Map();                         // unité → tâche (existante, adoptée) ou création prévue

  // Adoption : tâches du projet pas encore étiquetées, rangées par parent.
  const duProjet = taches.filter(t => t.projectId === projet.id && !estImportee(t));
  const idsProjet = new Set(duProjet.map(t => t.id));
  const enfantsDe = pid => duProjet.filter(t => (pid ? t.parentTaskId === pid : !t.parentTaskId || !idsProjet.has(t.parentTaskId)));
  const adoptees = new Set();
  const cleTache = t => cle(extrairePriorite(t.title).titre);

  for (const { unite: u } of aplatir(unites.racines)) {
    const existante = u.ids.map(id => index.get(id)).find(Boolean);
    if (existante) {                                   // déjà importée : on complète l'étiquette si besoin
      const manquants = u.ids.filter(id => !existante.notion.ids.includes(id));
      if (manquants.length) plan.etiquetages.push({ tacheId: existante.id, ids: manquants, titre: u.titre });
      tacheDe.set(u, { id: existante.id });
      continue;
    }
    if (u.ids.some(id => idsDejaImportes.has(id))) {  // importée puis supprimée dans l'app : on respecte
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
  else if (!idsDejaImportes.size) {
    // Premier import sans --adoption alors que le projet contient déjà ces titres → doublons probables.
    const cles = new Set(aplatir(unites.racines).map(x => x.unite.cle));
    plan.homonymes = duProjet.filter(t => cles.has(cleTache(t))).map(t => t.title);
  }

  const toutesIds = aplatir(unites.racines).flatMap(x => x.unite.ids);
  plan.registre = { mois: date, ids: [...new Set([...idsDejaImportes, ...toutesIds])] };
  plan.total = index.size ? new Set(index.values()).size : 0;
  plan.total += plan.creations.length + plan.adoptions.length;
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
  const taches = (blob.tasks || []).map(t => ({ ...t }));
  const parId = new Map(taches.map(t => [t.id, t]));
  const existants = new Set(parId.keys());
  const idCree = new Map();                          // unité → id de la tâche créée

  for (const e of plan.etiquetages) {
    const t = parId.get(e.tacheId);
    t.notion = { ...t.notion, ids: [...t.notion.ids, ...e.ids] };
  }
  for (const a of plan.adoptions) {
    const t = parId.get(a.tacheId);
    t.notion = { ids: a.ids, mois: date };
    if (a.prio) Object.assign(t, drapeaux(a.prio));
    if (a.echeance) { t.dueDate = echeanceApp(a.echeance.jour); t.dueTime = a.echeance.heure; }
  }
  for (const c of plan.creations) {
    const u = c.unite;
    const parentId = c.parentRef ? (c.parentRef.id || idCree.get(c.parentRef.creation.unite)) : null;
    const id = nouvelId(existants, maintenant);
    idCree.set(u, id);
    taches.push({
      id,
      title: u.titre,
      note: "",
      dueDate: u.echeance ? echeanceApp(u.echeance.jour) : null,
      dueTime: u.echeance ? u.echeance.heure : null,
      ...drapeaux(c.prio || 4),
      completed: false,
      createdAt: maintenant,
      projectId: projet.id,
      parentTaskId: parentId,
      recurrence: null,
      notion: { ids: [...u.ids], mois: date }
    });
  }
  return { ...blob, tasks: taches };
}

/* ---------- Clôture ---------- */

// Descendance complète (ids) d'un ensemble de tâches.
function avecDescendance(taches, ids) {
  const out = new Set(ids);
  let ajout = true;
  while (ajout) {
    ajout = false;
    for (const t of taches) if (t.parentTaskId && out.has(t.parentTaskId) && !out.has(t.id)) { out.add(t.id); ajout = true; }
  }
  return out;
}

// Prépare toute la clôture, avant la moindre écriture. Le plan est enregistré sur le disque : si la
// clôture est interrompue, la reprise se fait sur CE plan (la page Notion a pu être déjà vidée).
export function planifierCloture({ noeuds, modele, blob, registre }) {
  const date = modele.date;
  const taches = blob.tasks || [];
  const index = indexEtiquettes(taches, date);
  const importes = new Set(registre.mois === date ? registre.ids || [] : []);
  const avert = [];

  if (modele.nonCopiables.length) stop(`« Dans 1 mois » contient un bloc impossible à recopier (${modele.nonCopiables.join(", ")}).`,
    "Retire ce bloc (ou remplace-le par du texte), puis relance.");
  const jamais = modele.cases.filter(c => !c.vide && !importes.has(c.id));
  if (jamais.length) stop(`${jamais.length === 1 ? "Cette case est" : "Ces cases sont"} dans Notion mais n'${jamais.length === 1 ? "a" : "ont"} jamais été importée${jamais.length === 1 ? "" : "s"} : ${jamais.map(c => `« ${c.titre} »`).join(", ")}.`,
    "Lance « objectifs import », ou supprime la case dans Notion, puis relance « objectifs cloture ».");

  // Statut de chaque case : cochée / non cochée / supprimée dans l'app.
  const pleines = modele.cases.filter(c => !c.vide);
  const statut = new Map(pleines.map(c => [c.id, index.has(c.id) ? !!index.get(c.id).completed : null]));

  // Score : une tâche = une unité (les cases fusionnées comptent une fois).
  const presentes = new Map();                       // tâche → titre Notion de sa 1re case
  for (const c of pleines) if (index.has(c.id) && !presentes.has(index.get(c.id))) presentes.set(index.get(c.id), c.titre);
  const faits = [...presentes.keys()].filter(t => t.completed).length;
  const total = presentes.size;

  // Copie fidèle de la section : cases mises à jour, cases supprimées dans l'app retirées,
  // ligne de score remplie avec le score final.
  const copier = noeuds => noeuds.flatMap(n => {
    if (n.type === "to_do" && statut.get(n.id) === null) return [];
    const data = chargeDe(n, m => avert.push(m));
    if (n.type === "to_do" && statut.has(n.id)) data.checked = statut.get(n.id);
    if (n === modele.scoreNoeud) data.rich_text = reecrireScore(n.data.rich_text, `${faits}/${total} :`);
    return [{ type: n.type, data, enfants: copier(n.enfants || []) }];
  });
  const archive = copier(noeuds);

  const orphelinesNotion = [...new Set(index.values())].filter(t => !presentes.has(t)).map(t => t.title);
  if (orphelinesNotion.length) avert.push(`Tâche(s) importée(s) dont la case a disparu de Notion (retirées de l'app, absentes de l'archive) : ${orphelinesNotion.map(t => `« ${t} »`).join(", ")}.`);

  const aRetirer = avecDescendance(taches, taches.filter(t => estImportee(t) && t.notion.mois === date).map(t => t.id));
  const manuelles = taches.filter(t => aRetirer.has(t.id) && !estImportee(t)).map(t => t.title);

  // Cases à retirer du modèle : celles qui ne sont pas sous une autre case (leurs enfants partent avec).
  const casesModele = [];
  parcourir(noeuds, (n, anc) => { if (n.type === "to_do" && !anc.some(a => a.type === "to_do")) casesModele.push(n.id); });

  return {
    date,
    archive,
    faits, total,
    nonFaits: [...presentes].filter(([t]) => !t.completed).map(([, titre]) => titre),
    retirees: pleines.filter(c => statut.get(c.id) === null && !pleines.some(p => p.id === c.parentId && statut.get(p.id) === null)).map(c => c.titre),
    manuelles,
    nbTachesARetirer: aRetirer.size,
    casesModele,
    dateNoeudId: modele.dateNoeud.id,
    scoreNoeudId: modele.scoreNoeud.id,
    avert
  };
}

// Retire du blob tous les objectifs du mois `date` (et leur descendance) → { blob, nb }.
export function appliquerRetrait(blob, date) {
  const taches = blob.tasks || [];
  const ids = avecDescendance(taches, taches.filter(t => estImportee(t) && t.notion.mois === date).map(t => t.id));
  return { blob: { ...blob, tasks: taches.filter(t => !ids.has(t.id)) }, nb: ids.size };
}
