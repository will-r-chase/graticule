import { PUBLIC_R2_URL } from '$env/static/public';
import type { Catalog } from '$lib/types';

export async function load({ fetch }) {
	const response = await fetch(`${PUBLIC_R2_URL}/catalog.json`);

	if (!response.ok) {
		throw new Error(`Failed to fetch catalog: ${response.status}`);
	}

	const catalog: Catalog = await response.json();

	return { catalog };
}
