// Analyse de la section « Dans 1 mois » (SPEC § 4.2) : date de revue, ligne de score, cases.
import { stop } from "./erreurs.js";
import { NIVEAUX_MAX } from "./parametres.js";
import { extrairePriorite, cle, jourDe, heureDe, estPremierDuMois, formatFr } from "./texte.js";
import { texteCanon, texteSansDates, datesDe, lireScore, parcourir, estCopiable } from "./blocs.js";

// noeuds = arbre lu par lireArbre(section). Renvoie :
// { dateNoeud, date, scoreNoeud, score: { faits, total }, cases: [...], nonCopiables: [types] }
export function analyserSection(noeuds) {
  // --- Date de revue : première ligne non vide, qui doit contenir une mention de date ---
  const premiere = noeuds.find(n => texteCanon(n.data.rich_text).trim() !== "");
  const datesTete = premiere ? datesDe(premiere.data.rich_text) : [];
  if (!datesTete.length) stop("Date de revue introuvable en tête de « Dans 1 mois ».",
    "La première ligne doit être la date de revue (mention @01/MM/AAAA). Ajoute-la dans Notion, puis relance.");
  const date = jourDe(datesTete[0].start);
  if (!estPremierDuMois(date)) stop(`La date de revue (${formatFr(date)}) n'est pas un 1er du mois.`,
    "Corrige la mention de date en tête de « Dans 1 mois » (format @01/MM/AAAA), puis relance.");

  // --- Ligne de score « / : » : exactement une, parmi les lignes directes de la section ---
  const scores = noeuds.filter(n => n.type !== "to_do" && lireScore(n.data.rich_text));
  if (scores.length === 0) stop("Ligne de score « / : » introuvable dans « Dans 1 mois ».",
    "Ajoute une ligne « / : » sous la date de revue dans Notion, puis relance.");
  if (scores.length > 1) stop("Plusieurs lignes de score « / : » dans « Dans 1 mois ».",
    "Garde une seule ligne « / : » sous la date de revue, puis relance.");

  // --- Cases à cocher, dans l'ordre du document ---
  const cases = [];
  const vides = new Set();                           // cases sans texte : elles « s'effacent » (SPEC § 4.2)
  const nonCopiables = new Set();
  parcourir(noeuds, (n, ancetres) => {
    if (!estCopiable(n.type)) nonCopiables.add(n.type);
    if (n.type !== "to_do") return;
    const rt = n.data.rich_text;
    const { titre, prio } = extrairePriorite(texteSansDates(rt));
    const dates = datesDe(rt);
    const casesAncetres = ancetres.filter(a => a.type === "to_do" && !vides.has(a.id));
    const vide = titre === "";
    if (vide) vides.add(n.id);
    else if (casesAncetres.length + 1 > NIVEAUX_MAX) stop(`La case « ${titre} » est au niveau ${casesAncetres.length + 1} : l'app accepte ${NIVEAUX_MAX} niveaux au maximum.`,
      "Remonte cette case d'un niveau dans Notion, puis relance.");
    cases.push({
      id: n.id,
      titre,
      cle: cle(titre),
      prio,
      echeance: dates.length ? { jour: jourDe(dates[0].start), heure: heureDe(dates[0].start) } : null,
      vide,
      parentId: casesAncetres.length ? casesAncetres[casesAncetres.length - 1].id : null   // case non vide la plus proche
    });
  });
  return { dateNoeud: premiere, date, scoreNoeud: scores[0], score: lireScore(scores[0].data.rich_text), cases, nonCopiables: [...nonCopiables] };
}
