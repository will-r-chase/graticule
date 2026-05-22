# Custom Datasets

Drop your custom linework files here alongside a `.meta.json` companion file.

## Adding a dataset

1. Add your spatial file: `my-dataset.geojson` (or `.shp`, `.gpkg`, `.kml`, `.topojson`)
2. Add a metadata file: `my-dataset.meta.json`
3. Commit and push
4. Trigger the pipeline manually in GitHub Actions (or wait for the next scheduled run)

## Metadata format

```json
{
  "id": "custom/my-dataset",
  "name": "My Dataset Name",
  "description": "What this linework is and where it came from.",
  "region": "europe",
  "admin_level": 0,
  "tags": ["hand-drawn", "stylized", "countries"],
  "license": "owned",
  "bbox": [-10, 35, 40, 72]
}
```

### Fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique identifier, e.g. `custom/my-dataset` |
| `name` | yes | Display name shown in the catalog |
| `description` | yes | Short description for the catalog UI |
| `region` | yes | Geographic region: `world`, `europe`, `usa`, `asia`, etc. |
| `admin_level` | yes | `0` = countries, `1` = states/provinces, `2` = counties/districts |
| `tags` | yes | Array of strings for filtering, e.g. `["hand-drawn", "stylized"]` |
| `license` | yes | License string, e.g. `owned`, `cc-by-4.0`, `public-domain` |
| `bbox` | no | `[minLng, minLat, maxLng, maxLat]` — auto-computed from geometry if omitted |

## Supported file formats

- GeoJSON (`.geojson`, `.json`)
- Shapefile (`.shp` — keep all sidecar files in the same directory)
- GeoPackage (`.gpkg`)
- KML (`.kml`)
- TopoJSON (`.topojson`)
