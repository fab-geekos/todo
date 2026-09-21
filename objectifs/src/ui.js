// Affichage console et confirmations « o/n ».
import { createInterface } from "node:readline/promises";

// Affichages composés, construits sur info() et avert() : définis une seule fois, pour la vraie console
// comme pour les doublures de test.
export function avecListes(ui) {
  ui.liste = (titre, lignes) => {
    if (!lignes.length) return;
    ui.info(`\n${titre}`);
    lignes.forEach(l => ui.info(`  ${l}`));
  };
  ui.avertissements = liste => {
    if (!liste.length) return;
    ui.info("");
    liste.forEach(a => ui.avert(a));
  };
  return ui;
}

export function creerUI({ entree = process.stdin, sortie = process.stdout } = {}) {
  const ecrire = texte => sortie.write(texte + "\n");
  return avecListes({
    titre: t => ecrire(`\n=== ${t} ===\n`),
    info: t => ecrire(t),
    ok: t => ecrire(`✅ ${t}`),
    avert: t => ecrire(`⚠️  ${t}`),
    // Seul « o » / « oui » vaut accord (tout le reste = non : on ne devine jamais).
    async demander(question) {
      const rl = createInterface({ input: entree, output: sortie });
      try { return /^(o|oui)$/i.test((await rl.question(`\n${question} (o/n) `)).trim()); }
      finally { rl.close(); }
    }
  });
}
