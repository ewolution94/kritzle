import { EwoElement as e, css as t, define as n } from "./base.js";
import { emblemSvg as r, emblemTheme as i, parseEmblem as a } from "./emblem-core.js";
//#region packages/elements/src/emblem.ts
var o = t`
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
`, s = class extends e {
	static styles = [o];
	static observedAttributes = [
		"theme",
		"value",
		"size",
		"mood",
		"crown",
		"boil",
		"dead",
		"label"
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
		return a(this.getAttribute("value")) ?? [];
	}
	set value(e) {
		this.setAttribute("value", Array.isArray(e) ? e.join(",") : String(e));
	}
	get theme() {
		return i(this.getAttribute("theme")).id;
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
		let e = i(this.getAttribute("theme")), t = this.hasAttribute("boil") ? e.frames ?? 1 : 1, n = {
			mood: this.getAttribute("mood") ?? "",
			crown: this.hasAttribute("crown"),
			dead: this.hasAttribute("dead")
		}, a = "", o = t > 1 ? "frame boil" : "frame";
		for (let i = 0; i < t; i++) a += `<span class="${o}">${r(e.id, this.value, {
			...n,
			frame: i
		})}</span>`;
		this.root.innerHTML = a;
	}
};
n("ewo-emblem", s);
//#endregion
export { s as EwoEmblem };
