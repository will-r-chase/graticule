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
// Non-reactive: only ensureFontLoaded/variantsForFamily read it.
const googleMeta = new Map<string, string[]>();
// family → raw style strings from queryLocalFonts ('Regular', 'Semibold Italic', …).
const localMeta = new Map<string, string[]>();
let googleFetch: Promise<void> | null = null;

// A weight/style combination a font can be drawn in.
export interface FontVariant {
	weight: number;   // CSS weight, 100–900
	italic: boolean;
	label: string;    // e.g. 'Semibold Italic'
}

const WEIGHT_NAMES: Record<number, string> = {
	100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular',
	500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black',
};

function weightName(weight: number): string {
	return WEIGHT_NAMES[weight] ?? String(weight);
}

function variantLabel(weight: number, italic: boolean): string {
	const w = weightName(weight);
	return italic ? (weight === 400 ? 'Italic' : `${w} Italic`) : w;
}

// Parses a Google Fonts variant token ('regular', '700', 'italic', '700italic', …).
function parseGoogleVariant(v: string): { weight: number; italic: boolean } {
	const italic = v.includes('italic');
	const digits = v.match(/\d+/);
	return { weight: digits ? parseInt(digits[0], 10) : 400, italic };
}

// Parses a font-face style name from queryLocalFonts ('Bold', 'Semibold Italic',
// 'Light', 'Black Oblique', …) into a weight + italic flag. Order matters: check
// the more specific names (extralight, semibold, extrabold) before their substrings.
function parseStyleName(style: string): { weight: number; italic: boolean } {
	const s = style.toLowerCase();
	const italic = /italic|oblique/.test(s);
	let weight = 400;
	if (/thin|hairline/.test(s)) weight = 100;
	else if (/extra ?light|ultra ?light/.test(s)) weight = 200;
	else if (/\blight\b/.test(s)) weight = 300;
	else if (/medium/.test(s)) weight = 500;
	else if (/semi ?bold|demi ?bold/.test(s)) weight = 600;
	else if (/extra ?bold|ultra ?bold/.test(s)) weight = 800;
	else if (/black|heavy/.test(s)) weight = 900;
	else if (/bold/.test(s)) weight = 700;
	return { weight, italic };
}

// Regular/Bold × italic — used when a family has no queryable metadata (curated
// system fonts before local-font permission is granted).
const FALLBACK_VARIANTS: { weight: number; italic: boolean }[] = [
	{ weight: 400, italic: false },
	{ weight: 700, italic: false },
	{ weight: 400, italic: true },
	{ weight: 700, italic: true },
];

function dedupeSort(list: { weight: number; italic: boolean }[]): FontVariant[] {
	const seen = new Map<string, { weight: number; italic: boolean }>();
	for (const v of list) seen.set(`${v.weight}-${v.italic}`, v);
	const arr = [...seen.values()];
	arr.sort((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight);
	return arr.map((v) => ({ ...v, label: variantLabel(v.weight, v.italic) }));
}

// Weight/style combinations available for a font family: exact metadata for
// Google fonts and (once permission is granted) local fonts, otherwise a
// Regular/Bold × italic fallback.
export function variantsForFamily(family: string): FontVariant[] {
	const google = googleMeta.get(family);
	if (google) return dedupeSort(google.map(parseGoogleVariant));
	const local = localMeta.get(family);
	if (local) return dedupeSort(local.map(parseStyleName));
	return dedupeSort(FALLBACK_VARIANTS);
}

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
			queryLocalFonts(): Promise<{ family: string; style: string }[]>;
		}).queryLocalFonts());
		const byFamily = new Map<string, Set<string>>();
		for (const f of list) {
			if (!byFamily.has(f.family)) byFamily.set(f.family, new Set());
			byFamily.get(f.family)!.add(f.style);
		}
		for (const [family, styles] of byFamily) localMeta.set(family, [...styles]);
		fonts.localFamilies = [...byFamily.keys()].sort();
		fonts.localLoaded = true;
	} catch {
		// Permission denied or API failure — nothing to do.
	}
}

// One stylesheet injection per family, memoized — requests every variant the
// family has up front so any weight/italic combo picked later is already covered.
const stylesheetLoads = new Map<string, Promise<void>>();

function ensureStylesheet(family: string, variants: string[]): Promise<void> {
	const existing = stylesheetLoads.get(family);
	if (existing) return existing;
	const load = injectStylesheet(family, variants);
	stylesheetLoads.set(family, load);
	return load;
}

// One load per family+weight+italic combo, memoized. The promise resolves once
// that specific face is usable on canvas (or determined to need no loading).
const fontLoads = new Map<string, Promise<void>>();

// Makes sure a specific weight/italic face of a family is usable on canvas.
// System/local fonts need nothing; Google families get their stylesheet injected
// (once, covering all variants) and the requested face is awaited via
// document.fonts.load (canvas silently falls back if a font isn't ready —
// measurement/drawing must wait), then fonts.version bumps to trigger a repaint.
// Idempotent: the render loop can call it every frame for pennies, and pickers
// can await it to avoid a fallback flash.
export function ensureFontLoaded(family: string, weight = 400, italic = false): Promise<void> {
	if (!family) return Promise.resolve();
	const key = `${family}|${weight}|${italic}`;
	const existing = fontLoads.get(key);
	if (existing) return existing;
	const load = (async () => {
		await loadGoogleFontList();
		const variants = googleMeta.get(family);
		// Not a Google font — a system/local family (or unknown; browser fallback).
		if (!variants) return;
		// The stylesheet must be fully loaded/parsed before document.fonts.load can see
		// its @font-face rules — calling too early resolves with no match and the
		// fallback font sticks.
		await ensureStylesheet(family, variants);
		const face = `${italic ? 'italic ' : ''}${weight} 16px "${family}"`;
		await document.fonts.load(face).catch(() => {});
		fonts.version++;
	})();
	fontLoads.set(key, load);
	return load;
}

// css2 request for every variant the family provides, so any weight/italic combo
// document.fonts.load asks for later is already covered by one stylesheet.
// Resolves once the stylesheet has loaded (or failed), so callers can safely hand
// the family to document.fonts.load afterwards.
function injectStylesheet(family: string, variants: string[]): Promise<void> {
	// Tuple order matters to css2: ital ascending, then weight ascending.
	const axes = [...new Set(variants.map(parseGoogleVariant).map((v) => `${v.italic ? 1 : 0},${v.weight}`))]
		.sort((a, b) => {
			const [ai, aw] = a.split(',').map(Number);
			const [bi, bw] = b.split(',').map(Number);
			return ai - bi || aw - bw;
		});

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
