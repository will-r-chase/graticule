# Shapefile test fixtures

Shapefiles are binary and can't be generated as text. Use the following to populate this folder:

## valid.zip
Use any Natural Earth 1:110m shapefile, e.g.:
https://www.naturalearthdata.com/downloads/110m-cultural-vectors/
Download "Admin 0 – Countries", rename the zip to `valid.zip`.

## error-missing-dbf.zip
Take `valid.zip`, unzip it, remove the `.dbf` file, and re-zip:
```sh
cp valid.zip error-missing-dbf.zip
unzip error-missing-dbf.zip -d tmp-shp
rm tmp-shp/*.dbf
cd tmp-shp && zip ../error-missing-dbf.zip * && cd ..
rm -rf tmp-shp
```

## error-missing-prj.zip
Same process, removing the `.prj` file instead:
```sh
unzip valid.zip -d tmp-shp
rm tmp-shp/*.prj
cd tmp-shp && zip ../error-missing-prj.zip * && cd ..
rm -rf tmp-shp
```

## error-wrong-projection.zip
A shapefile in a non-WGS84 CRS. US state government data is a good source —
many publish in State Plane or UTM. Example:
NYC open data often publishes in EPSG:2263 (NY State Plane, feet).
