// Blocs et texte enrichi Notion : lecture, copie fidèle (archive) et comparaison.
// Un « nœud » = { id, type, data, enfants } où data = block[type] (lu) ou la charge utile (à créer).
import { stop } from "./erreurs.js";
import { jourDe } from "./texte.js";

/* ---------- Texte enrichi ---------- */

// Texte canonique (pour comparer deux versions d'un bloc) : les mentions sont réduites à leur cible.
export function texteCanon(rt = []) {
  return rt.map(it => {
    if (it.type === "text") return it.text.content;
    if (it.type === "equation") return `$${it.equation.expression}$`;
    if (it.type === "mention") {
      const m = it.mention;
      if (m.date) return `@date:${m.date.start}${m.date.end ? "→" + m.date.end : ""}`;
      if (m.page) return `@page:${m.page.id}`;
      if (m.user) return `@user:${m.user.id}`;
      if (m.database) return `@db:${m.database.id}`;
    }
    return it.plain_text || "";
  }).join("");
}

// Texte lisible SANS les mentions de date (sert de titre de tâche dans l'app).
export function texteSansDates(rt = []) {
  return rt.map(it => {
    if (it.type === "mention" && it.mention.date) return " ";
    if (it.type === "text") return it.text.content;
    if (it.type === "equation") return it.equation.expression;
    return it.plain_text || "";
  }).join("");
}

// Mentions de date d'un texte enrichi, dans l'ordre : [{ start, end }].
export function datesDe(rt = []) {
  return rt.filter(it => it.type === "mention" && it.mention.date).map(it => it.mention.date);
}

const ANNOTATIONS = ["bold", "italic", "strikethrough", "underline", "code", "color"];
function annotationsDe(it) {
  const a = it.annotations || {};
  const out = {};
  for (const k of ANNOTATIONS) if (a[k] !== undefined) out[k] = a[k];
  return out;
}

// Texte enrichi lu → texte enrichi CRÉABLE (l'API refuse les champs en lecture seule).
// Les mentions non recréables (aperçus de liens…) deviennent du texte avec lien : `avert` est prévenu.
export function nettoyerTexte(rt = [], avert = () => {}) {
  return rt.map(it => {
    const annotations = annotationsDe(it);
    if (it.type === "text") {
      const link = it.text.link && it.text.link.url ? { url: it.text.link.url } : null;
      return { type: "text", text: { content: it.text.content, link }, annotations };
    }
    if (it.type === "equation") return { type: "equation", equation: { expression: it.equation.expression }, annotations };
    if (it.type === "mention") {
      const m = it.mention;
      if (m.date) {
        const date = { start: m.date.start, end: m.date.end || null };
        if (m.date.time_zone) date.time_zone = m.date.time_zone;
        return { type: "mention", mention: { date }, annotations };
      }
      if (m.page) return { type: "mention", mention: { page: { id: m.page.id } }, annotations };
      if (m.user) return { type: "mention", mention: { user: { id: m.user.id } }, annotations };
      if (m.database) return { type: "mention", mention: { database: { id: m.database.id } }, annotations };
    }
    avert(`Mention « ${it.plain_text} » recopiée comme simple texte dans l'archive.`);
    const link = it.href ? { url: it.href } : null;
    return { type: "text", text: { content: it.plain_text || "", link }, annotations };
  });
}

/* ---------- Ligne de score : « / : », « /9 : », « 6/9 : » (la suite après « : » est conservée) ---------- */

const SCORE_RE = /^\s*(\d*)\s*\/\s*(\d*)\s*:/;

// Score lu sur une ligne → { faits, total } (null quand la partie est vide), ou null si ce n'en est pas une.
export function lireScore(rt = []) {
  const m = texteCanon(rt).match(SCORE_RE);
  if (!m) return null;
  return { faits: m[1] === "" ? null : Number(m[1]), total: m[2] === "" ? null : Number(m[2]) };
}

// Le score lu vaut-il exactement faits/total ? (null = partie vide : « /9 : » → faits null)
export const scoreVaut = (score, faits, total) => !!score && score.faits === faits && score.total === total;

const texteScore = (faits, total) => `${faits ?? ""}/${total ?? ""} :`;

// Réécrit le début « x/y : » d'une ligne de score, en gardant la suite intacte (SPEC § 4.2).
export function reecrireScore(rt, faits, total) {
  const conseil = "Remets « / : » en début de ligne dans Notion, puis relance.";
  const propre = nettoyerTexte(rt);
  const m = texteCanon(propre).match(SCORE_RE);
  if (!m) stop("La ligne de score « / : » n'a pas le format attendu.", conseil);
  let reste = m[0].length;          // nb de caractères à retirer au début
  const suite = [];
  for (const it of propre) {
    const txt = texteCanon([it]);
    if (reste >= txt.length) { reste -= txt.length; continue; }
    if (reste > 0) {
      if (it.type !== "text") stop("La ligne de score contient une mention avant « : ».", conseil);
      suite.push({ ...it, text: { ...it.text, content: it.text.content.slice(reste) } });
      reste = 0;
    } else suite.push(it);
  }
  const annotations = propre[0] ? propre[0].annotations : {};
  return [{ type: "text", text: { content: texteScore(faits, total), link: null }, annotations }, ...suite];
}

/* ---------- Dates ---------- */

export function mentionDate(jour) {
  return { type: "mention", mention: { date: { start: jour, end: null } } };
}

// Remplace une date de revue par une autre dans un texte enrichi (ligne de date du modèle).
export function remplacerDate(rt, ancienJour, nouveauJour) {
  return nettoyerTexte(rt).map(it =>
    (it.type === "mention" && it.mention.date && jourDe(it.mention.date.start) === ancienJour)
      ? { ...it, mention: mentionDate(nouveauJour).mention }
      : it);
}

// Le texte enrichi contient-il une mention du jour « AAAA-MM-JJ » ?
export const mentionneJour = (rt, jour) => datesDe(rt).some(d => jourDe(d.start) === jour);

// Blocs datés du jour `jour` (archives d'un mois parmi les enfants de Archives › Dans 1 mois).
export const blocsDates = (noeuds, jour) => noeuds.filter(n => mentionneJour(n.data.rich_text, jour));

/* ---------- Blocs ---------- */

// Types recopiables dans l'archive, et les champs qu'on recopie pour chacun.
const COPIE = {
  paragraph: ["rich_text", "color"],
  heading_1: ["rich_text", "color", "is_toggleable"],
  heading_2: ["rich_text", "color", "is_toggleable"],
  heading_3: ["rich_text", "color", "is_toggleable"],
  bulleted_list_item: ["rich_text", "color"],
  numbered_list_item: ["rich_text", "color"],
  to_do: ["rich_text", "checked", "color"],
  toggle: ["rich_text", "color"],
  quote: ["rich_text", "color"],
  callout: ["rich_text", "color", "icon"],
  divider: [],
  code: ["rich_text", "language", "caption"]
};
export const estCopiable = type => Object.prototype.hasOwnProperty.call(COPIE, type);

// Charge utile de création d'un bloc lu (sans ses enfants, créés ensuite niveau par niveau).
export function chargeDe(noeud, avert) {
  const champs = COPIE[noeud.type];
  if (!champs) stop(`Bloc de type « ${noeud.type} » impossible à recopier dans l'archive.`,
    "Retire ce bloc de « Dans 1 mois » (ou remplace-le par du texte), puis relance.");
  const data = {};
  for (const k of champs) {
    const v = noeud.data[k];
    if (v === undefined) continue;
    if (k === "rich_text" || k === "caption") data[k] = nettoyerTexte(v, avert);
    else if (k === "icon") {
      if (v && v.type === "emoji") data.icon = { type: "emoji", emoji: v.emoji };
      else if (v && v.type === "external") data.icon = { type: "external", external: { url: v.external.url } };
    } else data[k] = v;
  }
  return data;
}

// Nœud → bloc au format de l'API (création).
export const blocApi = n => ({ object: "block", type: n.type, [n.type]: n.data });

// Empreinte comparable d'un arbre (lu dans Notion ou prévu dans le plan) : type, texte, case cochée.
function canon(noeuds) {
  return noeuds.map(n => ({
    t: n.type,
    x: texteCanon(n.data.rich_text || []),
    ...(n.type === "to_do" ? { c: !!n.data.checked } : {}),
    e: canon(n.enfants || [])
  }));
}

// Deux arbres ont-ils le même contenu (types, textes, cases cochées, hiérarchie) ?
export const memesArbres = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// Parcours en profondeur (ordre du document) : fn(noeud, ancetres).
export function parcourir(noeuds, fn, ancetres = []) {
  for (const n of noeuds) {
    fn(n, ancetres);
    parcourir(n.enfants || [], fn, [...ancetres, n]);
  }
}

// Cases qui ne sont sous aucune autre case : les supprimer emporte leurs sous-cases.
export function casesDeTete(noeuds) {
  const out = [];
  parcourir(noeuds, (n, anc) => { if (n.type === "to_do" && !anc.some(a => a.type === "to_do")) out.push(n); });
  return out;
}
