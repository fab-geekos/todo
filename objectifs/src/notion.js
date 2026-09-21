// Accès à Notion : adaptateur mince autour du client officiel + lecture des sections.
import { stop } from "./erreurs.js";
import { cleChemin } from "./texte.js";
import { texteCanon, blocApi } from "./blocs.js";

// Notion accepte environ 3 requêtes par seconde : on en lance au plus 3 en même temps (au-delà,
// le client officiel attend et réessaie tout seul, ce qui ne ferait que ralentir).
export const REQUETES_SIMULTANEES = 3;

// File d'attente : au plus `max` promesses en cours. Une requête n'occupe une place que le temps
// de son aller-retour (pas pendant la lecture de ses enfants) : aucun blocage possible.
function limiteur(max) {
  let actives = 0;
  const file = [];
  const suivant = () => {
    if (actives >= max || !file.length) return;
    actives++;
    const { fn, ok, ko } = file.shift();
    fn().then(ok, ko).finally(() => { actives--; suivant(); });
  };
  return fn => new Promise((ok, ko) => { file.push({ fn, ok, ko }); suivant(); });
}

// Comme Promise.all, mais attend que TOUT soit terminé avant de signaler la première erreur :
// aucune écriture ne continue en arrière-plan après un échec (la reprise part d'un état stable).
export async function tous(promesses) {
  const r = await Promise.allSettled(promesses);
  const echec = r.find(x => x.status === "rejected");
  if (echec) throw echec.reason;
  return r.map(x => x.value);
}

// `client` = instance de @notionhq/client (ou le faux client des tests : mêmes méthodes).
// Le client officiel réessaie seul les limitations de débit, et ne rejoue JAMAIS une écriture
// après une erreur serveur (pas de doublon possible dans l'archive).
export function adaptateurNotion(client) {
  const file = limiteur(REQUETES_SIMULTANEES);
  const N = {
    requetes: 0,                                    // compteur affiché avec --temps
    appel(fn) { N.requetes++; return file(fn); },
    async enfants(blockId) {
      const out = [];
      let curseur;
      do {
        const r = await N.appel(() => client.blocks.children.list({ block_id: blockId, start_cursor: curseur, page_size: 100 }));
        out.push(...r.results);
        curseur = r.has_more ? r.next_cursor : undefined;
      } while (curseur);
      return out;
    },
    bloc(blockId) {
      return N.appel(() => client.blocks.retrieve({ block_id: blockId }));
    },
    // Ajoute des blocs à la fin de `parentId` (par paquets de 100, limite de l'API) → blocs créés.
    async ajouter(parentId, blocs) {
      const crees = [];
      for (let i = 0; i < blocs.length; i += 100) {
        const r = await N.appel(() => client.blocks.children.append({ block_id: parentId, children: blocs.slice(i, i + 100) }));
        crees.push(...r.results);
      }
      return crees;
    },
    async modifier(blockId, type, data) {
      await N.appel(() => client.blocks.update({ block_id: blockId, [type]: data }));
    },
    async supprimer(blockId) {
      await N.appel(() => client.blocks.delete({ block_id: blockId }));   // → corbeille Notion (30 jours)
    }
  };
  return N;
}

// Identifiant d'une page à partir de son lien Notion (ou de l'identifiant lui-même).
export function idDePage(lienOuId) {
  const m = String(lienOuId || "").replace(/-/g, "").match(/([0-9a-f]{32})(?:\?|#|$)/i);
  if (!m) stop("Lien de la page Notion invalide dans config.local.json.", "Copie le lien de la page (menu ⋯ → Copier le lien) dans « notion.page ».");
  return m[1];
}

// Bloc lu → nœud { id, type, data, aEnfants }.
export const noeudDe = b => ({ id: b.id, type: b.type, data: b[b.type] || {}, aEnfants: !!b.has_children, enfants: [] });

// Texte d'un bloc pour la recherche de chemin (titre d'une sous-page ou texte du bloc).
function texteDe(n) {
  if (n.type === "child_page") return n.data.title || "";
  return texteCanon(n.data.rich_text || []);
}

// Lit tout l'arbre sous `blockId` (sans descendre dans les sous-pages ni les bases de données).
// Les branches sont lues en parallèle (le limiteur de l'adaptateur borne le nombre de requêtes).
export async function lireArbre(N, blockId) {
  const noeuds = (await N.enfants(blockId)).map(noeudDe);
  await tous(noeuds
    .filter(n => n.aEnfants && n.type !== "child_page" && n.type !== "child_database")
    .map(async n => { n.enfants = await lireArbre(N, n.id); }));
  return noeuds;
}

// Enfants directs dont le texte correspond au libellé (emojis et ponctuation ignorés).
async function enfantsNommes(N, parentId, libelle) {
  const cible = cleChemin(libelle);
  return (await N.enfants(parentId)).map(noeudDe).filter(n => cleChemin(texteDe(n)) === cible);
}

// Suit un chemin de libellés depuis la page (« Dev perso » › « Objectifs » › …) → { id, parentId }.
// Le 1er libellé est cherché en profondeur (il peut être dans une colonne, une sous-page…), les
// suivants parmi les enfants directs. Introuvable ou ambigu → arrêt.
export async function trouverChemin(N, pageId, chemin) {
  const nom = chemin.join(" › ");
  let courant = null, parentId = null;
  // 1er libellé : recherche en largeur, niveau par niveau (4 niveaux au plus).
  let niveau = [pageId];
  for (let prof = 0; prof < 4 && !courant; prof++) {
    const suivants = [], trouves = [];
    for (const id of niveau) {
      for (const n of (await N.enfants(id)).map(noeudDe)) {
        if (cleChemin(texteDe(n)) === cleChemin(chemin[0])) trouves.push({ n, parent: id });
        else if (n.aEnfants && n.type !== "child_database") suivants.push(n.id);
      }
    }
    if (trouves.length > 1) stop(`« ${chemin[0]} » apparaît plusieurs fois dans la page Notion.`, "Renomme l'un des deux blocs, ou précise le chemin dans config.local.json.");
    if (trouves.length === 1) ({ n: courant, parent: parentId } = trouves[0]);
    niveau = suivants;
  }
  if (!courant) stop(`« ${chemin[0]} » introuvable dans la page Notion.`, "Vérifie le lien de la page dans config.local.json et que l'intégration y est connectée (menu ⋯ → Connexions).");
  for (const libelle of chemin.slice(1)) {
    const trouves = await enfantsNommes(N, courant.id, libelle);
    if (trouves.length === 0) stop(`Section « ${nom} » introuvable : pas de « ${libelle} » sous « ${texteDe(courant)} ».`, "Un titre a peut-être été renommé dans Notion. Remets le nom d'origine ou adapte le chemin dans config.local.json.");
    if (trouves.length > 1) stop(`« ${libelle} » apparaît plusieurs fois sous « ${texteDe(courant)} ».`, "Renomme l'un des blocs dans Notion, puis relance.");
    parentId = courant.id;
    courant = trouves[0];
  }
  return { id: courant.id, parentId };
}

const sansTirets = id => String(id || "").replace(/-/g, "");

// Un emplacement mémorisé est-il toujours bon ? Le bloc ET son parent sont relus (en parallèle) :
// aucun des deux à la corbeille, bon nom pour chacun (« Dans 1 mois » sous « Archives » ≠ « Dans
// 1 mois » sous « Objectifs »), et le bloc est bien toujours rangé sous ce parent.
async function emplacementValide(N, memo, chemin) {
  try {
    const [b, p] = await tous([N.bloc(memo.id), N.bloc(memo.parentId)]);
    const parentDeB = b.parent ? b.parent[b.parent.type] : null;
    const nomParent = chemin.length > 1 ? chemin[chemin.length - 2] : null;
    return !b.in_trash && !b.archived && !p.in_trash && !p.archived
      && sansTirets(parentDeB) === sansTirets(memo.parentId)
      && cleChemin(texteDe(noeudDe(b))) === cleChemin(chemin[chemin.length - 1])
      && (!nomParent || cleChemin(texteDe(noeudDe(p))) === cleChemin(nomParent));
  } catch {
    return false;                                   // supprimé, inaccessible… → on recherche
  }
}

// Emplacement d'un chemin : mémorisé si toujours valide (1 aller-retour), sinon recherché puis mémorisé.
async function emplacement(N, pageId, chemin, cache) {
  const cle = `${sansTirets(pageId)}|${chemin.join(" › ")}`;
  const memo = cache && cache.lire(cle);
  if (memo && await emplacementValide(N, memo, chemin)) return memo.id;
  const trouve = await trouverChemin(N, pageId, chemin);
  if (cache) cache.ecrire(cle, trouve);
  return trouve.id;
}

// Localise « Dans 1 mois » (et, pour la clôture, Archives › Dans 1 mois) : SPEC § 4.1.
// `cache` (facultatif) : { lire(cle), ecrire(cle, valeur) } pour mémoriser les emplacements.
export async function localiserSections(N, config, { archives = true, cache = null } = {}) {
  const pageId = idDePage(config.notion.page);
  const base = config.notion.cheminObjectifs;
  const [sectionId, archivesId] = await tous([
    emplacement(N, pageId, [...base, config.notion.section], cache),
    archives ? emplacement(N, pageId, [...base, ...config.notion.cheminArchives], cache) : null
  ]);
  return { sectionId, archivesId };
}

// Crée un arbre de nœuds sous `parentId`, niveau par niveau (l'API limite l'imbrication par requête).
// L'ordre est garanti dans chaque parent ; les sous-arbres de parents différents sont créés en parallèle.
export async function creerArbre(N, parentId, noeuds) {
  const crees = await N.ajouter(parentId, noeuds.map(blocApi));
  if (crees.length !== noeuds.length) stop("Notion n'a pas créé tous les blocs de l'archive.", "Relance la commande : elle reprendra où elle s'est arrêtée.");
  await tous(noeuds.map((n, i) => (n.enfants || []).length ? creerArbre(N, crees[i].id, n.enfants) : null));
  return crees;
}
