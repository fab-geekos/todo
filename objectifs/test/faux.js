// Doublures de test : faux client Notion (mêmes méthodes et mêmes formes que @notionhq/client),
// faux Firestore, fausse console. Aucun accès réseau.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { avecListes } from "../src/ui.js";

const clone = v => JSON.parse(JSON.stringify(v));
const TYPES = new Set(["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item",
  "to_do", "toggle", "quote", "callout", "divider", "code", "image", "child_page", "column_list"]);

/* ---------- Faux Notion ---------- */

// Texte enrichi « tel que renvoyé par l'API » (avec plain_text, annotations complètes, href).
function versReponse(item) {
  const annotations = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default", ...(item.annotations || {}) };
  if (item.type === "mention" || item.mention) {
    const m = item.mention;
    if (m.date) return { type: "mention", mention: { type: "date", date: { start: m.date.start, end: m.date.end || null, time_zone: m.date.time_zone || null } }, annotations, plain_text: m.date.start, href: null };
    if (m.page) return { type: "mention", mention: { type: "page", page: { id: m.page.id } }, annotations, plain_text: "Une page", href: `https://www.notion.so/${m.page.id}` };
    if (m.link_preview) return { type: "mention", mention: { type: "link_preview", link_preview: { url: m.link_preview.url } }, annotations, plain_text: m.link_preview.url, href: m.link_preview.url };
    throw new Error("faux Notion : mention non gérée " + JSON.stringify(m));
  }
  if (item.type === "equation") return { type: "equation", equation: clone(item.equation), annotations, plain_text: item.equation.expression, href: null };
  return { type: "text", text: { content: item.text.content, link: item.text.link || null }, annotations, plain_text: item.text.content, href: item.text.link ? item.text.link.url : null };
}

// Contrôle strict des charges utiles envoyées (l'API refuse les champs en lecture seule).
function verifierTexteEnvoye(rt) {
  if (!Array.isArray(rt)) throw new Error("validation_error: rich_text doit être un tableau");
  for (const it of rt) {
    for (const k of Object.keys(it)) if (!["type", "text", "mention", "equation", "annotations"].includes(k)) throw new Error(`validation_error: champ interdit « ${k} » dans rich_text`);
    if (it.mention && (it.mention.link_preview || it.mention.link_mention)) throw new Error("validation_error: mention non créable");
    if (it.type === "text" && it.text.content.length > 2000) throw new Error("validation_error: texte > 2000");
  }
}

export class FauxNotion {
  constructor() {
    this.blocs = new Map();       // id → { id, type, data, parent, enfants: [ids], in_trash }
    this.seq = 0;
    this.appels = { list: 0, append: 0, update: 0, delete: 0, retrieve: 0 };
    this.panne = null;            // { methode, n, apres } : la n-ième requête de ce type échoue
    this.tailleMax = 2;           // petite pagination : oblige le code à suivre next_cursor
    this.latence = 0;             // ms de « réseau » simulé par requête (0 = immédiat)
    this.enCours = 0;
    this.maxEnCours = 0;          // nombre maximal de requêtes simultanées observé
    const self = this;
    const reseau = fn => p => self._reseau(() => fn(p));
    this.blocks = {
      children: {
        list: reseau(p => self._list(p)),
        append: reseau(p => self._append(p))
      },
      retrieve: reseau(p => { self.appels.retrieve++; return self._reponse(self._vivant(p.block_id)); }),
      update: reseau(p => self._update(p)),
      delete: reseau(p => self._delete(p))
    };
  }

  async _reseau(fn) {
    this.enCours++;
    this.maxEnCours = Math.max(this.maxEnCours, this.enCours);
    try {
      if (this.latence) await new Promise(r => setTimeout(r, this.latence));
      return fn();
    } finally { this.enCours--; }
  }

  _id() {
    const h = (++this.seq).toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${h}`;
  }

  // Panne simulée (coupure réseau) : `apres` = la requête a été exécutée mais la réponse est perdue.
  _panne(methode, action) {
    this.appels[methode]++;
    if (this.panne && this.panne.methode === methode && this.appels[methode] === this.panne.n) {
      const apres = this.panne.apres;
      this.panne = null;
      if (apres) action();
      throw new Error(`ECONNRESET simulé (${methode})`);
    }
    return action();
  }

  // Comme l'API : un identifiant est accepté avec ou sans tirets.
  _vivant(id) {
    const brut = String(id).replace(/-/g, "");
    const cle = [...this.blocs.keys()].find(k => k.replace(/-/g, "") === brut);
    if (!cle) { const e = new Error("Could not find block"); e.code = "object_not_found"; throw e; }
    return this.blocs.get(cle);
  }

  _reponse(b) {
    const data = clone(b.data);
    if (data.rich_text) data.rich_text = data.rich_text.map(versReponse);
    const parent = b.parent ? { type: this.blocs.get(b.parent).type === "child_page" ? "page_id" : "block_id" } : { type: "workspace", workspace: true };
    if (b.parent) parent[parent.type] = b.parent;
    return { object: "block", id: b.id, type: b.type, parent, has_children: b.enfants.some(id => !this.blocs.get(id).in_trash), in_trash: b.in_trash, [b.type]: data };
  }

  _list({ block_id, start_cursor, page_size = 100 }) {
    this.appels.list++;
    const b = this._vivant(block_id);
    const vivants = b.enfants.filter(id => !this.blocs.get(id).in_trash);
    const debut = start_cursor ? vivants.indexOf(start_cursor) : 0;
    const taille = Math.min(page_size, this.tailleMax);
    const page = vivants.slice(debut, debut + taille);
    const suivant = vivants[debut + taille];
    return { results: page.map(id => this._reponse(this.blocs.get(id))), has_more: !!suivant, next_cursor: suivant || null };
  }

  _creer(parentId, type, data) {
    const id = this._id();
    this.blocs.set(id, { id, type, data: clone(data), parent: parentId, enfants: [], in_trash: false });
    return id;
  }

  _append({ block_id, children }) {
    const parent = this._vivant(block_id);
    if (parent.in_trash) throw new Error("validation_error: bloc dans la corbeille");
    if (!Array.isArray(children) || children.length > 100) throw new Error("validation_error: 100 enfants au maximum");
    for (const c of children) {
      if (!TYPES.has(c.type) || !c[c.type]) throw new Error(`validation_error: bloc invalide ${JSON.stringify(c)}`);
      if (c[c.type].children) throw new Error("faux Notion : enfants imbriqués non gérés");
      if (c[c.type].rich_text) verifierTexteEnvoye(c[c.type].rich_text);
    }
    return this._panne("append", () => {
      const ids = children.map(c => {
        const data = clone(c[c.type]);
        if (data.rich_text) data.rich_text = data.rich_text.map(versReponse).map(r => ({ ...r }));
        const id = this._creer(parent.id, c.type, data);
        parent.enfants.push(id);
        return id;
      });
      return { results: ids.map(id => this._reponse(this.blocs.get(id))) };
    });
  }

  _update(p) {
    const b = this._vivant(p.block_id);
    if (b.in_trash) throw new Error("validation_error: bloc dans la corbeille");
    const maj = p[b.type];
    if (!maj) throw new Error("validation_error: type de bloc différent");
    if (maj.rich_text) verifierTexteEnvoye(maj.rich_text);
    return this._panne("update", () => {
      Object.assign(b.data, clone(maj));
      if (maj.rich_text) b.data.rich_text = maj.rich_text.map(versReponse);
      return this._reponse(b);
    });
  }

  _delete({ block_id }) {
    const b = this._vivant(block_id);
    if (b.in_trash) throw new Error("validation_error: déjà dans la corbeille");
    return this._panne("delete", () => { b.in_trash = true; return this._reponse(b); });
  }

  /* --- Construction et lecture pour les tests --- */

  // Crée une page à partir d'une description (cf. helpers `toggle`, `para`, `todo`…). → id de page.
  page(enfants) {
    const pageId = this._creer(null, "child_page", { title: "Page de test" });
    this.ajouterSous(pageId, enfants);
    return pageId;
  }
  ajouterSous(parentId, specs, { apres } = {}) {
    const parent = this.blocs.get(parentId);
    const ids = specs.map(s => {
      const data = s.type === "divider" ? {} : { rich_text: s.rt.map(versReponse), color: s.color || "default" };
      if (s.type === "to_do") data.checked = !!s.checked;
      if (s.type === "image") Object.assign(data, { type: "external", external: { url: "https://exemple.org/a.png" } });
      const id = this._creer(parentId, s.type, data);
      this.ajouterSous(id, s.enfants || []);
      return id;
    });
    if (apres) parent.enfants.splice(parent.enfants.indexOf(apres) + 1, 0, ...ids);
    else parent.enfants.push(...ids);
    return ids;
  }
  // Premier bloc vivant dont le texte (canonique) contient `texte`.
  trouver(texte, depuis = null) {
    for (const b of this.blocs.values()) {
      if (b.in_trash || (depuis && !this._descend(b.id, depuis))) continue;
      if (texteSimple(b.data.rich_text || []).includes(texte)) return b.id;
    }
    return null;
  }
  _descend(id, ancetre) {
    for (let b = this.blocs.get(id); b; b = this.blocs.get(b.parent)) if (b.parent === ancetre) return true;
    return false;
  }
  // Arbre lisible (sans identifiants) pour comparer des états : "☑ texte", "¶ texte", "▸ texte"…
  dump(id) {
    const b = this.blocs.get(id);
    return b.enfants.filter(e => !this.blocs.get(e).in_trash).map(e => {
      const c = this.blocs.get(e);
      const signe = { to_do: c.data.checked ? "☑" : "☐", paragraph: "¶", toggle: "▸", divider: "hr", image: "🖼" }[c.type] || c.type;
      const x = texteSimple(c.data.rich_text || []);
      const gras = (c.data.rich_text || []).some(r => r.annotations && r.annotations.bold) ? "**" : "";
      const sous = this.dump(e);
      return sous.length ? { [`${signe} ${gras}${x}`]: sous } : `${signe} ${gras}${x}`;
    });
  }
}

export const texteSimple = rt => rt.map(r => r.type === "mention" && r.mention.date ? `@${r.mention.date.start}` : (r.plain_text ?? r.text.content)).join("");

// Helpers de description : chaque segment est un texte ou { date } / { texte, bold, color }.
const seg = s => {
  if (typeof s === "string") return { type: "text", text: { content: s, link: null } };
  if (s.date) return { type: "mention", mention: { date: { start: s.date } } };
  if (s.pageMention) return { type: "mention", mention: { page: { id: s.pageMention } } };
  if (s.lien) return { type: "mention", mention: { link_preview: { url: s.lien } } };
  return { type: "text", text: { content: s.texte, link: null }, annotations: { bold: !!s.bold, color: s.color || "default" } };
};
const rt = x => (Array.isArray(x) ? x : [x]).map(seg);
export const toggle = (texte, enfants = []) => ({ type: "toggle", rt: rt(texte), enfants });
export const para = (texte, enfants = []) => ({ type: "paragraph", rt: rt(texte), enfants });
export const gras = (texte, enfants = []) => ({ type: "paragraph", rt: [seg({ texte, bold: true })], enfants });
export const todo = (texte, enfants = [], checked = false) => ({ type: "to_do", rt: rt(texte), enfants, checked });
export const image = () => ({ type: "image", rt: [], enfants: [] });
export const date = d => ({ date: d });
export const P = n => ({ texte: `P${n}`, color: ["red", "orange", "blue"][n - 1] });

/* ---------- Faux Firestore (même interface que src/store.js) ---------- */

export class FauxStore {
  constructor(blob, registre = { mois: null, ids: [] }) {
    this.blob = clone(blob);
    this.registre = clone(registre);
    this.ecritures = 0;
    this.panne = false;           // true : la prochaine transaction échoue (coupure réseau)
  }
  async lire() { return { blob: clone(this.blob), registre: clone(this.registre) }; }
  async transaction(fn) {
    if (this.panne) { this.panne = false; throw new Error("UNAVAILABLE simulé (Firestore)"); }
    const res = fn({ blob: clone(this.blob), registre: clone(this.registre) });
    if (!res) return false;
    this.blob = clone(res.blob);
    this.registre = clone({ mois: res.registre.mois, ids: res.registre.ids });
    this.ecritures++;
    return true;
  }
}

/* ---------- Fausse console ---------- */

export class FausseUI {
  constructor(reponses = [], { pendantQuestion } = {}) {
    this.reponses = [...reponses];
    this.lignes = [];
    this.questions = [];
    this.pendantQuestion = pendantQuestion;
    avecListes(this);             // mêmes listes et avertissements que la vraie console
  }
  titre(t) { this.lignes.push(`=== ${t}`); }
  info(t) { this.lignes.push(t); }
  ok(t) { this.lignes.push(`OK ${t}`); }
  avert(t) { this.lignes.push(`AVERT ${t}`); }
  async demander(q) {
    this.questions.push(q);
    if (this.pendantQuestion) await this.pendantQuestion(q);
    if (!this.reponses.length) throw new Error(`Question inattendue : ${q}`);
    return this.reponses.shift() === "o";
  }
  get texte() { return this.lignes.join("\n"); }
}

// Dossiers de sauvegarde jetables, effacés à la fin des tests.
const temporaires = [];
process.on("exit", () => temporaires.forEach(d => rmSync(d, { recursive: true, force: true })));
export const dossierTemp = () => {
  const d = mkdtempSync(join(tmpdir(), "objectifs-test-"));
  temporaires.push(d);
  return d;
};
