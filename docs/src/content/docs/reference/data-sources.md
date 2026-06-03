---
title: Data Sources
description: The geographic data sources available in Graticule's catalog and their characteristics.
---

Graticule's catalog draws from several curated public sources. Understanding each source helps you pick the right data for a given map.

## Natural Earth

**Coverage:** worldwide  
**License:** public domain  
**Best for:** world maps, continental maps, multi-country maps

Natural Earth is the most widely used source for world map basemap data. It's maintained by a community of cartographers and available at three scale levels:

- **10m** — 1:10,000,000 scale. High detail, suitable for country-level and continental maps where you want visible geographic nuance.
- **50m** — 1:50,000,000 scale. A good default for most world maps.
- **110m** — 1:110,000,000 scale. Highly simplified. Useful for small multiples or maps where detail isn't the goal.

Natural Earth covers countries, states/provinces, coastlines, rivers, lakes, ocean, land, populated places, and more. The admin boundaries are well-maintained and handle disputed territories thoughtfully.

## US Census TIGER

**Coverage:** United States  
**License:** public domain  
**Best for:** US-specific maps at state or county level

TIGER (Topologically Integrated Geographic Encoding and Referencing) is the authoritative source for US administrative boundaries, maintained by the US Census Bureau. It's updated regularly and is the correct source for any map requiring accurate US administrative geography.

Graticule includes:
- **States** — the 50 states plus DC and territories
- **Counties** — all ~3,200 US counties and county-equivalents

TIGER data is considerably more detailed than Natural Earth's US boundaries and is the right choice for any map focused specifically on the US.

## Eurostat NUTS

**Coverage:** European Union member states  
**License:** CC BY 4.0 (attribution required)  
**Best for:** EU regional analysis, European administrative maps

NUTS (Nomenclature of Territorial Units for Statistics) is the EU's hierarchical system for dividing member states into regions for statistical purposes. Three levels are available:

- **NUTS 1** — major socioeconomic regions (e.g. East of England, Bayern, Île-de-France)
- **NUTS 2** — basic regions for applying EU regional policies (~240 regions)
- **NUTS 3** — small regions for specific diagnoses (~1,500 regions)

NUTS boundaries are primarily administrative and statistical rather than geographic, and don't cover non-EU European countries. For broader European coverage, use Natural Earth.

## Project Linework

**Coverage:** varies by dataset  
**License:** owned by the Graticule team  
**Best for:** maps where aesthetics and craftsmanship matter

Project Linework is a collection of hand-curated and stylized geographic linework created by the Graticule team. Unlike the programmatically generated datasets above, Project Linework datasets are drawn and refined by hand with cartographic intent — they're designed to look good, not just to be accurate.

These datasets are suitable for maps where the aesthetic quality of the linework is important: editorial illustration, print cartography, design work.

---

## A note on geographic accuracy

All sources in Graticule's catalog are reputable and widely used, but no boundary dataset is perfectly authoritative for all purposes. Boundaries are contested, updated over time, and defined differently by different organizations. For maps that will be published or used in a professional context, verify that your chosen source matches the conventions of your audience and use case.
