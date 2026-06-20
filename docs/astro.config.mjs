// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://docs.graticule.org',
	integrations: [
		starlight({
			title: 'Graticule',
			customCss: ['./src/styles/custom.css'],
			components: {
				SiteTitle: './src/components/SiteTitle.astro',
			},
			head: [
				{
					tag: 'script',
					content: 'document.documentElement.dataset.theme = "light"',
				},
			],
			social: [
				{ icon: 'external', label: 'graticule.org', href: 'https://graticule.org' },
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/will-r-chase/graticule' },
			],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'What is Graticule', slug: '' },
						{ label: 'Release Notes', slug: 'release-notes' },
					],
				},
				{
					label: 'Data',
					items: [
						{ label: 'The Catalog', slug: 'data/catalog' },
						{ label: 'Uploading Your Own Data', slug: 'data/uploading' },
					],
				},
				{
					label: 'Layers',
					items: [
						{ label: 'Working with Layers', slug: 'layers/working-with-layers' },
						{ label: 'Styling', slug: 'layers/styling' },
						{ label: 'Simplification & Smoothing', slug: 'layers/simplification' },
					],
				},
				{
					label: 'Features',
					items: [
						{ label: 'Working with Features', slug: 'features/working-with-features' },
						{ label: 'Editing Features', slug: 'features/editing-features' },
						{ label: 'Features Table', slug: 'features/features-table' },
					],
				},
				{
					label: 'Projections',
					items: [
						{ label: 'Projections', slug: 'projections' },
					],
				},
				{
					label: 'Export & Save',
					items: [
						{ label: 'Exporting', slug: 'export-and-save/exporting' },
						{ label: 'Saving & Loading', slug: 'export-and-save/saving-and-loading' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Keyboard Shortcuts', slug: 'reference/keyboard-shortcuts' },
						{ label: 'File Formats', slug: 'reference/file-formats' },
						{ label: 'Data Sources', slug: 'reference/data-sources' },
					],
				},
				{
					label: 'Blog',
					items: [
						{ label: 'Introducing Graticule', link: 'https://www.williamrchase.com/writing/2026-06-03-introducing-graticule', attrs: { target: '_blank', rel: 'noopener noreferrer' } },
						{ label: 'Designing an Interaction Model, Part 1', link: 'https://www.williamrchase.com/writing/2026-06-15-designing-an-interaction-model-for-graticule-part-1', attrs: { target: '_blank', rel: 'noopener noreferrer' } },
					],
				},
			],
		}),
	],
});
