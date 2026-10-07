import { EwoElement as e, css as t, define as n } from "./base.js";
import { TAG_COLOURS as r } from "./emblem-tag.js";
import { emblemSvg as i, emblemTheme as a, parseEmblem as o } from "./emblem-core.js";
//#region packages/elements/src/emblem.ts
var s = t`
  :host {
    --_e1: var(--ewo-emblem-1, #232a6e);
    --_e2: var(--ewo-emblem-2, var(--ewo-accent));
    --_e3: var(--ewo-emblem-3, #f4ecda);
    --_ink: var(--ewo-emblem-ink, var(--ewo-fg));
    --_strike: var(--ewo-emblem-strike, var(--ewo-bad));
    position: relative;
    display: inline-block;
    flex: none;
    width: var(--_size, 48px);
    height: var(--_size, 48px);
    vertical-align: middle;
  }
  .frame { position: absolute; inset: 0; }
  svg { display: block; width: 100%; height: 100%; overflow: visible; }

  .e1 { fill: var(--_e1); }
  .e2 { fill: var(--_e2); }
  .e3 { fill: var(--_e3); }
  .heraldry .charge { fill: var(--_e3); stroke: var(--_e1); stroke-width: 4; stroke-linejoin: round; paint-order: stroke; }
  .heraldry .rim { fill: none; stroke: var(--_ink); stroke-width: 4.5; stroke-linejoin: round; }
  .faded { filter: grayscale(1); opacity: 0.55; }
  .strike { fill: none; stroke: var(--_strike); stroke-width: 9; stroke-linecap: round; }

  /* The price tag: the chosen colour, a darker shade for the pattern, a fixed dark outline. */
  .tag { --_tink: var(--ewo-emblem-tag-ink, #212121); }
  ${r.map(([, e], t) => `.tag .tc${t} { --_e1: var(--ewo-emblem-tag-${t}, ${e}); }`).join("\n  ")}
  .tag .tp { fill: color-mix(in oklab, var(--_e1), #000 20%); }
  .tag .tb { fill: none; stroke: color-mix(in oklab, var(--_e1), #000 20%); stroke-width: 22; }
  .tag .trim { fill: none; stroke: var(--_tink); stroke-width: 4.5; stroke-linejoin: round; }
  .tag .thole { fill: var(--ewo-emblem-paper, #ffffff); stroke: var(--_tink); stroke-width: 3.5; }
  .tag .tf { fill: #ffffff; stroke: var(--_tink); stroke-width: 7; stroke-linejoin: round; paint-order: stroke; }
  .tag .tl { fill: none; stroke: var(--_tink); stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
  .tag .ti { fill: #ffffff; stroke: var(--_tink); stroke-width: 3.4; paint-order: stroke; font: 800 40px/1 var(--ewo-sans); }

  /* The doodle's face is round on paper; its crown may rise above the circle. */
  :host([theme='doodle']) { border-radius: 50%; background: var(--ewo-emblem-paper, #ffffff); }
  :host([theme='doodle'][ring]) { box-shadow: 0 0 0 2px var(--_ink); }
  :host([theme='doodle']:not([crown])) .frame { overflow: hidden; border-radius: 50%; }

  /* The boil: three redraws stepped in turn, like a cartoon held still (only themes that redraw). */
  .boil:nth-child(1) { animation: boil 0.42s steps(1) infinite; }
  .boil:nth-child(2) { animation: boil 0.42s -0.28s steps(1) infinite; }
  .boil:nth-child(3) { animation: boil 0.42s -0.14s steps(1) infinite; }
  @keyframes boil {
    0% { opacity: 1; }
    33.33% { opacity: 0; }
    100% { opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .boil { animation: none !important; }
    .boil:nth-child(n + 2) { opacity: 0; }
  }
`, c = class extends e {
	static styles = [s];
	static observedAttributes = [
		"theme",
		"value",
		"size",
		"mood",
		"crown",
		"boil",
		"dead",
		"label",
		"initial"
	];
	#e = this.attachInternals();
	connectedCallback() {
		this.#r();
	}
	attributeChangedCallback(e) {
		if (e === "size") return this.#t();
		if (e === "label") return this.#n();
		this.isConnected && this.#r();
	}
	get value() {
		return o(this.getAttribute("value")) ?? [];
	}
	set value(e) {
		this.setAttribute("value", Array.isArray(e) ? e.join(",") : String(e));
	}
	get theme() {
		return a(this.getAttribute("theme")).id;
	}
	set theme(e) {
		this.setAttribute("theme", e);
	}
	get dead() {
		return this.flag("dead");
	}
	set dead(e) {
		this.flag("dead", !!e);
	}
	get boil() {
		return this.flag("boil");
	}
	set boil(e) {
		this.flag("boil", !!e);
	}
	get ring() {
		return this.flag("ring");
	}
	set ring(e) {
		this.flag("ring", !!e);
	}
	get crown() {
		return this.flag("crown");
	}
	set crown(e) {
		this.flag("crown", !!e);
	}
	#t() {
		let e = this.getAttribute("size");
		e ? this.style.setProperty("--_size", /^\d+(\.\d+)?$/.test(e) ? `${e}px` : e) : this.style.removeProperty("--_size");
	}
	#n() {
		let e = this.getAttribute("label");
		this.#e.role = e ? "img" : null, this.#e.ariaLabel = e;
	}
	#r() {
		this.#t(), this.#n();
		let e = a(this.getAttribute("theme")), t = this.hasAttribute("boil") ? e.frames ?? 1 : 1, n = {
			mood: this.getAttribute("mood") ?? "",
			crown: this.hasAttribute("crown"),
			dead: this.hasAttribute("dead"),
			initial: this.getAttribute("initial") ?? ""
		}, r = "", o = t > 1 ? "frame boil" : "frame";
		for (let a = 0; a < t; a++) r += `<span class="${o}">${i(e.id, this.value, {
			...n,
			frame: a
		})}</span>`;
		this.root.innerHTML = r;
	}
};
n("ewo-emblem", c);
//#endregion
export { c as EwoEmblem };
