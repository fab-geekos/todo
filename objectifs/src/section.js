// Analyse de la section « Dans 1 mois » (SPEC § 4.2) : date de revue, ligne de score, cases.
import { stop } from "./erreurs.js";
import { extrairePriorite, cle, jourDe, heureDe, estPremierDuMois, formatFr } from "./texte.js";
import { texteCanon, texteSansDates, datesDe, SCORE_RE, parcourir, estCopiable } from "./blocs.js";

// noeuds = arbre lu par lireArbre(section). Renvoie :
// { dateNoeud, date, scoreNoeud, score: {faits, total}, cases: [...], nonCopiables: [types] }
export function analyserSection(noeuds) {
  // --- Date de revue : première ligne non vide, qui doit contenir une mention de date ---
  const premiere = noeuds.find(n => texteCanon(n.data.rich_text || []).trim() !== "" || n.type === "divider");
  const datesTete = premiere ? datesDe(premiere.data.rich_text || []) : [];
  if (!datesTete.length) stop("Date de revue introuvable en tête de « Dans 1 mois ».",
    "La première ligne doit être la date de revue (mention @01/MM/AAAA). Ajoute-la dans Notion, puis relance.");
  const date = jourDe(datesTete[0].start);
  if (!estPremierDuMois(date)) stop(`La date de revue (${formatFr(date)}) n'est pas un 1er du mois.`,
    "Corrige la mention de date en tête de « Dans 1 mois » (format @01/MM/AAAA), puis relance.");

  // --- Ligne de score « / : » : exactement une, parmi les lignes directes de la section ---
  const scores = noeuds.filter(n => n.type !== "to_do" && SCORE_RE.test(texteCanon(n.data.rich_text || [])));
  if (scores.length === 0) stop("Ligne de score « / : » introuvable dans « Dans 1 mois ».",
    "Ajoute une ligne « / : » sous la date de revue dans Notion, puis relance.");
  if (scores.length > 1) stop("Plusieurs lignes de score « / : » dans « Dans 1 mois ».",
    "Garde une seule ligne « / : » sous la date de revue, puis relance.");
  const m = texteCanon(scores[0].data.rich_text).match(SCORE_RE);
  const score = { faits: m[1] === "" ? null : Number(m[1]), total: m[2] === "" ? null : Number(m[2]) };

  // --- Cases à cocher, dans l'ordre du document ---
  const cases = [];
  const nonCopiables = new Set();
  parcourir(noeuds, (n, ancetres) => {
    if (!estCopiable(n.type)) nonCopiables.add(n.type);
    if (n.type !== "to_do") return;
    const rt = n.data.rich_text || [];
    const { titre, prio } = extrairePriorite(texteSansDates(rt));
    const dates = datesDe(rt);
    // Parent = case NON vide la plus proche (une case vide « s'efface » : SPEC § 4.2).
    const parentCase = [...ancetres].reverse().find(a => a.type === "to_do" && !a._vide);
    n._vide = titre === "";
    cases.push({
      id: n.id,
      titre,
      cle: cle(titre),
      prio,
      echeance: dates.length ? { jour: jourDe(dates[0].start), heure: heureDe(dates[0].start) } : null,
      vide: n._vide,
      coche: !!n.data.checked,
      parentId: parentCase ? parentCase.id : null,
      profondeurNotion: ancetres.filter(a => a.type === "to_do" && !a._vide).length + 1
    });
  });
  for (const c of cases) {
    if (!c.vide && c.profondeurNotion > 3) stop(`La case « ${c.titre} » est au niveau ${c.profondeurNotion} : l'app accepte 3 niveaux au maximum.`,
      "Remonte cette case d'un niveau dans Notion, puis relance.");
  }
  return { dateNoeud: premiere, date, scoreNoeud: scores[0], score, cases, nonCopiables: [...nonCopiables] };
}
