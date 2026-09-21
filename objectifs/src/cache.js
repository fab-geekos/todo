// Mémo local (à côté de la config, exclu de Git) : emplacements des sections Notion et identifiant
// Firebase, pour ne pas les rechercher à chaque lancement. Chaque valeur est revérifiée avant usage ;
// un mémo absent, illisible ou périmé ne fait que ralentir (on recherche puis on remémorise).
import { readFileSync, writeFileSync } from "node:fs";

export function ouvrirCache(chemin) {
  let donnees = {};
  try { donnees = JSON.parse(readFileSync(chemin, "utf8")); } catch { /* premier lancement */ }
  return {
    lire: cle => donnees[cle],
    ecrire(cle, valeur) {
      donnees[cle] = valeur;
      try { writeFileSync(chemin, JSON.stringify(donnees, null, 2)); } catch { /* sans gravité */ }
    }
  };
}
