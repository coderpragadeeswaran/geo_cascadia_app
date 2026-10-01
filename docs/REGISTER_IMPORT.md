# Importing a real property register

FarmwiseAI may provide property register data (D41). Until then every area is compared with a **synthetic** register that
copies what the photos show except a few planted mistakes (D42). This page shows how to load a real register instead.

The comparison pairs register records with buildings **by location** (D43), so a real register needs no OpenStreetMap IDs:
a position per record is enough.

## 1. What the register needs

| Field | Required? | Notes |
|---|---|---|
| id | **yes** | assessment number or any unique record id |
| position | **yes** | `lat` + `lon` columns, or a GeoJSON Point, or an `address` geocoded with `--geocode` |
| use | no | compared as commercial vs residential; values are mapped with `use_values` |
| floors | no | whole number; a building is flagged only when the photo shows **more** floors (measured) |
| area | no | plinth area in m² (or `"area_unit": "sqft"`); flagged when the record is under 75% of the outline |
| street | no | shown in reports |

A field that is missing or empty is **not compared**. It never produces a difference.

## 2. Write a mapping file

`my_register.mapping.json` names the register's own columns:

```json
{
  "id": "ASSESSMENT_NO",
  "lat": "LATITUDE",
  "lon": "LONGITUDE",
  "street": "STREET_NAME",
  "use": "USAGE",
  "floors": "NO_OF_FLOORS",
  "area": "PLINTH_AREA",
  "area_unit": "sqft",
  "use_values": {"Commercial": "commercial", "Residential": "residential", "Mixed": "mixed", "Shop": "commercial"}
}
```

Optional keys: `"address"` (a column to geocode), `"sheet"` (Excel sheet name), `"delimiter"`, `"encoding"`.

## 3. Load and check it

```powershell
backend\.venv\Scripts\python tools\import_register.py C:\data\ward29_register.csv --config my_register.mapping.json --area data\areas\ward29
```

It writes `data/registers/ward29_register.json` and prints a report:
- **rows read / loaded / skipped**, with the reason for every skipped row (no id, duplicate id, no coordinates, address not
  found, coordinates out of range) and the first 20 row numbers;
- use values that could not be compared (e.g. "Temple") and fields left empty;
- with `--area`: how the records pair with the area's buildings: matched, differs, building with no record, record with no
  building nearby (50 m), pin in the wrong place (> 15 m), and the match confidence (high / medium / low).

Nothing in the app changes yet.

Formats: CSV/TSV, GeoJSON (Point features; properties are the columns), Excel `.xlsx` (needs `pip install openpyxl` in the
backend venv). Addresses: `--geocode` uses the server key `GOOGLE_PLACES_SERVER_KEY` (Geocoding API must be allowed on it);
answers are cached in `data/cache/geocode/`.

## 4. Use it in the app

```powershell
backend\.venv\Scripts\python tools\import_register.py C:\data\ward29_register.csv --config my_register.mapping.json --area data\areas\ward29 --apply
backend\.venv\Scripts\python backend\load_area.py data\areas\ward29
```

`--apply` writes the comparison into the area's `export.json` (register fields, match status, differences, review queue,
dashboard) and saves `register_imported.json`. The synthetic register files are kept as `*.synthetic_backup.json`. The
reload keeps every review decision and lists the review items added and removed.

Then the app shows "IMPORTED" instead of "synthetic register (demo)" for that area. There is no planted-mistake test for a
real register, so Trust shows the pairing outcomes only.

## 5. How pairing works (D43)

1. Each record's pin is compared with every building within 50 m: its predicted front position (D33) and its outline centre.
2. The pairing cost is the distance in metres, plus 10 × |ln(record area / outline area)| and 5 m when the record's use
   category disagrees with what the photo shows.
3. Pairs are taken cheapest first, one record per building and one building per record.
4. Outcomes: matched (≤ 15 m) · pin in the wrong place (matched, > 15 m) · building with no record · record with no
   building nearby.
5. Match confidence: **high** ≤ 5 m and the next building is ≥ 5 m worse; **medium** ≤ 15 m and ≥ 2 m worse; else **low**.

On the synthetic registers (ids hidden from the matcher), 530 of the 538 records across the six areas (98.5%) pair with
their own building; of the 26 records whose pin was planted 15–40 m away, 18 (69.2%). Every record whose pin was not moved
pairs correctly. Trust › Register tests has the per-area numbers. A CSV made from the Ward 29 synthetic register (ids as
assessment numbers, area in sq ft) imports and pairs to exactly the same outcome as the app (304 matched, 50 differ, 27
with no record).
