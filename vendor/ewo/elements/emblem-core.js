import { doodle as e } from "./emblem-doodle.js";
import { heraldry as t, token as n } from "./emblem-heraldry.js";
import { tag as r } from "./emblem-tag.js";
//#region packages/elements/src/emblem-core.ts
var i = {
	heraldry: t,
	doodle: e,
	token: n,
	tag: r
};
function a(e) {
	return i[e ?? ""] ?? t;
}
function o(e) {
	return a(e).parts.map((e) => e.options.length);
}
function s(e, t) {
	let n = o(e);
	return Array.isArray(t) && t.length === n.length && t.every((e, t) => Number.isInteger(e) && e >= 0 && e < n[t]);
}
function c(e, t = Math.random) {
	return o(e).map((e) => Math.floor(t() * e));
}
function l(e, t, n = Math.random) {
	return s(e, t) ? [...t] : c(e, n);
}
function u(e, t) {
	return a(e).fromSeed(t >>> 0);
}
function d(e) {
	if (!e) return null;
	let t = e.split(",").map((e) => Number(e.trim()));
	return t.every(Number.isInteger) ? t : null;
}
function f(e, t, n = {}) {
	let r = a(e);
	return r.svg(s(r.id, t) ? t : r.parts.map(() => 0), n);
}
function p(e, t) {
	return a(e).parts.map((e) => ({
		name: e.name[t],
		options: e.options.map((e) => e[t])
	}));
}
//#endregion
export { i as THEMES, l as cleanEmblem, u as emblemFromSeed, p as emblemNames, o as emblemRanges, f as emblemSvg, a as emblemTheme, s as isEmblem, d as parseEmblem, c as randomEmblem };
