// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
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
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/will-r-chase/mappy' }],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'What is Graticule', slug: '' },
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
			],
		}),
	],
});
