---
title: Data Sources
description: The geographic data sources available in Graticule's catalog and their characteristics.
---

Graticule's catalog draws from four curated public sources.

## Natural Earth

**Coverage:** worldwide  
**License:** public domain  
**Best for:** world maps, continental maps, multi-country maps

Natural Earth is the most widely used source for world map basemap data, maintained by a community of cartographers. It comes at three scale levels:

- **10m** — 1:10,000,000 scale. High detail, suitable for country-level and continental maps where you want visible geographic nuance.
- **50m** — 1:50,000,000 scale. A good default for most world maps.
- **110m** — 1:110,000,000 scale. Highly simplified. Useful for small multiples or maps where detail isn't the goal.

Natural Earth covers countries, states/provinces, coastlines, rivers, lakes, ocean, land, and populated places. The admin boundaries are well-maintained and handle disputed territories thoughtfully.

## US Census TIGER

**Coverage:** United States  
**License:** public domain  
**Best for:** US-specific maps at state or county level

TIGER (Topologically Integrated Geographic Encoding and Referencing) is the authoritative source for US administrative boundaries, maintained by the US Census Bureau and updated regularly.

Graticule includes:

- **States** — the 50 states plus DC and territories
- **Counties** — all ~3,200 US counties and county-equivalents

TIGER is considerably more detailed than Natural Earth's US boundaries and the right choice for any map focused on the US.

## Eurostat NUTS

**Coverage:** European Union member states  
**License:** CC BY 4.0 (attribution required)  
**Best for:** EU regional analysis, European administrative maps

NUTS (Nomenclature of Territorial Units for Statistics) is the EU's hierarchical system for dividing member states into regions for statistical purposes. Three levels are available:

- **NUTS 1** — major socioeconomic regions (e.g. East of England, Bayern, Île-de-France)
- **NUTS 2** — basic regions for applying EU regional policies (~240 regions)
- **NUTS 3** — small regions for specific diagnoses (~1,500 regions)

NUTS boundaries are administrative and statistical, not geographic, and cover only EU member states. For broader European coverage, use Natural Earth.

## Project Linework

**Coverage:** varies by dataset  
**License:** varies by dataset (see projectlinework.org)  
**Best for:** maps where aesthetics and craftsmanship matter

[Project Linework](https://www.projectlinework.org/) is an open-source collection of hand-curated, stylized geographic linework. Unlike the programmatically generated datasets above, these are drawn and refined by hand with cartographic intent — designed to look good, not just to be accurate.

Use them for maps where linework quality matters: editorial illustration, print cartography, design work.

---

## A note on geographic accuracy

All sources in Graticule's catalog are reputable and widely used, but no boundary dataset is authoritative for every purpose. Boundaries are contested, updated over time, and defined differently by different organizations. For maps published in a professional context, verify that your chosen source matches the conventions of your audience.
