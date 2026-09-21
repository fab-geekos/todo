// Accès à Notion : adaptateur mince autour du client officiel + lecture des sections.
import { stop } from "./erreurs.js";
import { cleChemin } from "./texte.js";
import { texteCanon, blocApi } from "./blocs.js";

// `client` = instance de @notionhq/client (ou le faux client des tests : mêmes méthodes).
// Le client officiel réessaie seul les limitations de débit, et ne rejoue JAMAIS une écriture
// après une erreur serveur (pas de doublon possible dans l'archive).
export function adaptateurNotion(client) {
  return {
    async enfants(blockId) {
      const out = [];
      let curseur;
      do {
        const r = await client.blocks.children.list({ block_id: blockId, start_cursor: curseur, page_size: 100 });
        out.push(...r.results);
        curseur = r.has_more ? r.next_cursor : undefined;
      } while (curseur);
      return out;
    },
    // Ajoute des blocs à la fin de `parentId` (par paquets de 100, limite de l'API) → blocs créés.
    async ajouter(parentId, blocs) {
      const crees = [];
      for (let i = 0; i < blocs.length; i += 100) {
        const r = await client.blocks.children.append({ block_id: parentId, children: blocs.slice(i, i + 100) });
        crees.push(...r.results);
      }
      return crees;
    },
    async modifier(blockId, type, data) {
      await client.blocks.update({ block_id: blockId, [type]: data });
    },
    async supprimer(blockId) {
      await client.blocks.delete({ block_id: blockId });   // → corbeille Notion (30 jours)
    }
  };
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
export async function lireArbre(N, blockId) {
  const noeuds = (await N.enfants(blockId)).map(noeudDe);
  for (const n of noeuds) {
    if (n.aEnfants && n.type !== "child_page" && n.type !== "child_database") n.enfants = await lireArbre(N, n.id);
  }
  return noeuds;
}

// Enfants directs dont le texte correspond au libellé (emojis et ponctuation ignorés).
async function enfantsNommes(N, parentId, libelle) {
  const cible = cleChemin(libelle);
  return (await N.enfants(parentId)).map(noeudDe).filter(n => cleChemin(texteDe(n)) === cible);
}

// Suit un chemin de libellés depuis la page (« Dev perso » › « Objectifs » › …) → identifiant du bloc.
// Le 1er libellé est cherché en profondeur (il peut être dans une colonne, une sous-page…), les
// suivants parmi les enfants directs. Introuvable ou ambigu → arrêt.
export async function trouverChemin(N, pageId, chemin) {
  const nom = chemin.join(" › ");
  let courant = null;
  // 1er libellé : recherche en largeur, niveau par niveau (4 niveaux au plus).
  let niveau = [pageId];
  for (let prof = 0; prof < 4 && !courant; prof++) {
    const suivants = [], trouves = [];
    for (const id of niveau) {
      for (const n of (await N.enfants(id)).map(noeudDe)) {
        if (cleChemin(texteDe(n)) === cleChemin(chemin[0])) trouves.push(n);
        else if (n.aEnfants && n.type !== "child_database") suivants.push(n.id);
      }
    }
    if (trouves.length > 1) stop(`« ${chemin[0]} » apparaît plusieurs fois dans la page Notion.`, "Renomme l'un des deux blocs, ou précise le chemin dans config.local.json.");
    if (trouves.length === 1) courant = trouves[0];
    niveau = suivants;
  }
  if (!courant) stop(`« ${chemin[0]} » introuvable dans la page Notion.`, "Vérifie le lien de la page dans config.local.json et que l'intégration y est connectée (menu ⋯ → Connexions).");
  for (const libelle of chemin.slice(1)) {
    const trouves = await enfantsNommes(N, courant.id, libelle);
    if (trouves.length === 0) stop(`Section « ${nom} » introuvable : pas de « ${libelle} » sous « ${texteDe(courant)} ».`, "Un titre a peut-être été renommé dans Notion. Remets le nom d'origine ou adapte le chemin dans config.local.json.");
    if (trouves.length > 1) stop(`« ${libelle} » apparaît plusieurs fois sous « ${texteDe(courant)} ».`, "Renomme l'un des blocs dans Notion, puis relance.");
    courant = trouves[0];
  }
  return courant.id;
}

// Localise « Dans 1 mois » (et, pour la clôture, Archives › Dans 1 mois) : SPEC § 4.1.
export async function localiserSections(N, config, { archives = true } = {}) {
  const pageId = idDePage(config.notion.page);
  const base = config.notion.cheminObjectifs;
  const sectionId = await trouverChemin(N, pageId, [...base, config.notion.section]);
  const archivesId = archives ? await trouverChemin(N, pageId, [...base, ...config.notion.cheminArchives]) : null;
  return { sectionId, archivesId };
}

// Crée un arbre de nœuds sous `parentId`, niveau par niveau (l'API limite l'imbrication par requête).
export async function creerArbre(N, parentId, noeuds) {
  const crees = await N.ajouter(parentId, noeuds.map(blocApi));
  if (crees.length !== noeuds.length) stop("Notion n'a pas créé tous les blocs de l'archive.", "Relance la commande : elle reprendra où elle s'est arrêtée.");
  for (let i = 0; i < noeuds.length; i++) {
    if ((noeuds[i].enfants || []).length) await creerArbre(N, crees[i].id, noeuds[i].enfants);
  }
  return crees;
}
