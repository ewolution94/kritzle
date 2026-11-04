// The order a family setting is decided in (Dashboard, plans/dashboard.md in the workspace): this
// device's own choice, then Dashboard's default (the family's, or one set for Kritzle alone), then
// the built-in one, which is today's. public/boot.js does the same for the language before first
// paint. Kritzle is light only, so it takes no theme. No Svelte and no DOM here, so the tests load
// it as it is.

export type Lang = 'de' | 'en';

/** The language to show: this device's choice, else Dashboard's, else the browser's (`detected`). */
export const languageFor = (own: Lang | 'system', dashboard: unknown, detected: Lang): Lang =>
  own !== 'system' ? own : dashboard === 'de' || dashboard === 'en' ? dashboard : detected;

/**
 * Sounds: this device's switch as stored under `kritzle:sound` (`off`, or on for anything else;
 * none when it was never switched), else Dashboard's, else on. The manifest's own default is on
 * too, so the family's value doesn't reach Kritzle; one set for Kritzle does.
 */
export const soundsFor = (own: string | null, dashboard: unknown): boolean =>
  own !== null ? own !== 'off' : typeof dashboard === 'boolean' ? dashboard : true;
