import { doodle as e } from "./emblem-doodle.js";
import { heraldry as t, token as n } from "./emblem-heraldry.js";
//#region packages/elements/src/emblem-core.ts
var r = {
	heraldry: t,
	doodle: e,
	token: n
};
function i(e) {
	return r[e ?? ""] ?? t;
}
function a(e) {
	return i(e).parts.map((e) => e.options.length);
}
function o(e, t) {
	let n = a(e);
	return Array.isArray(t) && t.length === n.length && t.every((e, t) => Number.isInteger(e) && e >= 0 && e < n[t]);
}
function s(e, t = Math.random) {
	return a(e).map((e) => Math.floor(t() * e));
}
function c(e, t, n = Math.random) {
	return o(e, t) ? [...t] : s(e, n);
}
function l(e, t) {
	return i(e).fromSeed(t >>> 0);
}
function u(e) {
	if (!e) return null;
	let t = e.split(",").map((e) => Number(e.trim()));
	return t.every(Number.isInteger) ? t : null;
}
function d(e, t, n = {}) {
	let r = i(e);
	return r.svg(o(r.id, t) ? t : r.parts.map(() => 0), n);
}
function f(e, t) {
	return i(e).parts.map((e) => ({
		name: e.name[t],
		options: e.options.map((e) => e[t])
	}));
}
//#endregion
export { r as THEMES, c as cleanEmblem, l as emblemFromSeed, f as emblemNames, a as emblemRanges, d as emblemSvg, i as emblemTheme, o as isEmblem, u as parseEmblem, s as randomEmblem };
