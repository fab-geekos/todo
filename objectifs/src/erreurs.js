// Erreur « attendue » : le script s'arrête proprement et explique quoi faire (cf. SPEC § 8).
// `conseil` = la ligne « → quoi faire » affichée sous le message.
export class ErreurObjectifs extends Error {
  constructor(message, conseil = null) {
    super(message);
    this.name = "ErreurObjectifs";
    this.conseil = conseil;
  }
}

// Fabien a répondu « non » à une confirmation : arrêt normal, rien n'a été écrit.
export class Abandon extends Error {
  constructor(message = "Rien n'a été modifié.") {
    super(message);
    this.name = "Abandon";
  }
}

export function stop(message, conseil) {
  throw new ErreurObjectifs(message, conseil);
}
