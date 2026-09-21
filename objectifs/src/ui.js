// Affichage console et confirmations « o/n ».
import { createInterface } from "node:readline/promises";

export function creerUI({ entree = process.stdin, sortie = process.stdout } = {}) {
  const ecrire = texte => sortie.write(texte + "\n");
  return {
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
  };
}
