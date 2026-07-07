// Font catalog + on-demand webfont loading for label layers (docs/labels-plan.md, D8).
// Three sources: a curated list of common system fonts, locally installed fonts via
// queryLocalFonts (Chromium-only, permission-gated), and the Google Fonts catalog
// (fetched once per session, sorted by popularity).
//
// $env/dynamic/public (not static) so a missing PUBLIC_GOOGLE_FONTS_API_KEY degrades
// to "no Google Fonts" instead of failing the build.
import { env } from '$env/dynamic/public';

// Ships-with-the-OS families that render on macOS and Windows without loading anything.
export const CURATED_SYSTEM_FONTS = [
	'Arial',
	'Baskerville',
	'Courier New',
	'Futura',
	'Garamond',
	'Georgia',
	'Gill Sans',
	'Helvetica Neue',
	'Impact',
	'Palatino',
	'Tahoma',
	'Times New Roman',
	'Trebuchet MS',
	'Verdana',
];

export const fonts = $state({
	// Google Fonts family names, popularity-sorted. Empty until loadGoogleFontList runs.
	googleFamilies: [] as string[],
	// Installed fonts from queryLocalFonts, once the user has granted permission.
	localFamilies: [] as string[],
	localSupported: typeof window !== 'undefined' && 'queryLocalFonts' in window,
	localLoaded: false,
	// Bumped when a webfont finishes loading — repaint effects read this so text drawn
	// with a fallback font re-renders once the real font arrives.
	version: 0,
});

// family → available variants ('regular' | '700' | 'italic' | '700italic' | …).
// Non-reactive: only ensureFontLoaded reads it.
const googleMeta = new Map<string, string[]>();
let googleFetch: Promise<void> | null = null;

// Fetches the Google Fonts catalog once; concurrent/repeat calls share the promise.
// A failed fetch clears the memo so a later call can retry.
export function loadGoogleFontList(): Promise<void> {
	if (googleFetch) return googleFetch;
	googleFetch = (async () => {
		const key = env.PUBLIC_GOOGLE_FONTS_API_KEY;
		if (!key) {
			console.warn('PUBLIC_GOOGLE_FONTS_API_KEY not set — Google Fonts unavailable');
			return;
		}
		try {
			const r = await fetch(`https://www.googleapis.com/webfonts/v1/webfonts?key=${key}&sort=popularity`);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const data = (await r.json()) as { items?: { family: string; variants: string[] }[] };
			const items = data.items ?? [];
			for (const item of items) googleMeta.set(item.family, item.variants);
			fonts.googleFamilies = items.map((i) => i.family);
		} catch (err) {
			console.warn('Google Fonts catalog fetch failed:', err);
			googleFetch = null;
		}
	})();
	return googleFetch;
}

// Lists installed fonts via queryLocalFonts (triggers Chrome's permission prompt, so
// call it from a user gesture). Permission denied → curated list stays in place.
export async function requestLocalFonts(): Promise<void> {
	if (!fonts.localSupported || fonts.localLoaded) return;
	try {
		const list = (await (window as unknown as {
			queryLocalFonts(): Promise<{ family: string }[]>;
		}).queryLocalFonts());
		const seen = new Set<string>();
		for (const f of list) seen.add(f.family);
		fonts.localFamilies = [...seen].sort();
		fonts.localLoaded = true;
	} catch {
		// Permission denied or API failure — nothing to do.
	}
}

// One load per family, memoized. The promise resolves once the family is usable
// on canvas (or determined to need no loading).
const fontLoads = new Map<string, Promise<void>>();

// Makes sure a family is usable on canvas. System/local fonts need nothing; Google
// families get their stylesheet injected and are awaited via document.fonts.load
// (canvas silently falls back if a font isn't ready — measurement/drawing must wait),
// then fonts.version bumps to trigger a repaint. Idempotent: the render loop can call
// it every frame for pennies, and pickers can await it to avoid a fallback flash.
export function ensureFontLoaded(family: string): Promise<void> {
	if (!family) return Promise.resolve();
	const existing = fontLoads.get(family);
	if (existing) return existing;
	const load = (async () => {
		await loadGoogleFontList();
		const variants = googleMeta.get(family);
		// Not a Google font — a system/local family (or unknown; browser fallback).
		if (!variants) return;
		// The stylesheet must be fully loaded/parsed before document.fonts.load can see
		// its @font-face rules — calling too early resolves with no match and the
		// fallback font sticks.
		await injectStylesheet(family, variants);
		const loads: string[] = [];
		if (variants.includes('regular')) loads.push(`16px "${family}"`);
		if (variants.includes('700')) loads.push(`bold 16px "${family}"`);
		if (variants.includes('italic')) loads.push(`italic 16px "${family}"`);
		if (variants.includes('700italic')) loads.push(`italic bold 16px "${family}"`);
		if (loads.length === 0) loads.push(`16px "${family}"`);
		await Promise.all(loads.map((l) => document.fonts.load(l))).catch(() => {});
		fonts.version++;
	})();
	fontLoads.set(family, load);
	return load;
}

// css2 request for the variants our styling can use (regular/bold × normal/italic),
// intersected with what the family actually provides — css2 rejects unavailable axes.
// Resolves once the stylesheet has loaded (or failed), so callers can safely hand the
// family to document.fonts.load afterwards.
function injectStylesheet(family: string, variants: string[]): Promise<void> {
	// Tuple order matters to css2: ital ascending, then weight ascending.
	const axes: string[] = [];
	if (variants.includes('regular')) axes.push('0,400');
	if (variants.includes('700')) axes.push('0,700');
	if (variants.includes('italic')) axes.push('1,400');
	if (variants.includes('700italic')) axes.push('1,700');

	const famParam = family.replace(/ /g, '+');
	const url =
		axes.length > 0
			? `https://fonts.googleapis.com/css2?family=${famParam}:ital,wght@${axes.join(';')}&display=swap`
			: `https://fonts.googleapis.com/css2?family=${famParam}&display=swap`;

	return new Promise((resolve) => {
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = url;
		link.onload = () => resolve();
		link.onerror = () => resolve();
		document.head.appendChild(link);
	});
}
