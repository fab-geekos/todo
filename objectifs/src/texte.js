// Outils texte et dates, sans dépendance (purs, testés à part).

// Clé de comparaison de deux cases : sans casse, sans espaces en trop (SPEC § 4.2).
export function cle(texte) {
  return String(texte || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

// Comparaison d'un libellé de chemin (« 😁 Dev perso » ≈ « Dev perso ») : on ignore emojis et ponctuation.
export function cleChemin(texte) {
  return cle(String(texte || "").replace(/[^\p{L}\p{N}\s]/gu, " "));
}

// « Finir le dossier A P1 » → { titre: "Finir le dossier A", prio: 1 }. Sans P écrit → prio null.
const PRIO_RE = /\s*\bP([1-4])\s*$/i;
export function extrairePriorite(texte) {
  const brut = String(texte || "").replace(/\s+/g, " ").trim();
  const m = brut.match(PRIO_RE);
  if (!m) return { titre: brut, prio: null };
  return { titre: brut.slice(0, m.index).trim(), prio: Number(m[1]) };
}

// Ressemblance entre 0 et 1 (distance de Levenshtein rapportée à la longueur).
export function similarite(a, b) {
  a = cle(a); b = cle(b);
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/* ---- Dates. Un « mois » est identifié par sa date de revue : "2026-10-01" = objectifs de septembre. ---- */

// Partie jour d'une date Notion ("2026-10-15" ou "2026-10-15T14:00:00.000+02:00").
export const jourDe = start => String(start || "").slice(0, 10);

export function estPremierDuMois(jour) {
  return /^\d{4}-\d{2}-01$/.test(jour);
}

export function decalerMois(jour, n) {
  const [a, m] = jour.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

// "2026-10-01" → "01/10/2026" (format des archives, SPEC § 4.2)
export function formatFr(jour) {
  const [a, m, d] = jour.split("-");
  return `${d}/${m}/${a}`;
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
  "septembre", "octobre", "novembre", "décembre"];

// Date de revue "2026-10-01" → "septembre 2026" (le mois que ces objectifs couvrent).
export function libelleMoisCouvert(dateRevue) {
  const [a, m] = decalerMois(dateRevue, -1).split("-").map(Number);
  return `${MOIS[m - 1]} ${a}`;
}

// Jour local "AAAA-MM-JJ" (le PC est dans le même fuseau que l'app).
export function jourLocal(date) {
  const p = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// Échéance au format de l'app : minuit LOCAL en millisecondes (comme parseInput de l'app).
export function echeanceApp(jour) {
  const [a, m, d] = jour.split("-").map(Number);
  return new Date(a, m - 1, d).getTime();
}

// Heure éventuelle d'une date Notion : "2026-10-15T14:00:00.000+02:00" → "14:00".
export function heureDe(start) {
  const m = String(start || "").match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}
