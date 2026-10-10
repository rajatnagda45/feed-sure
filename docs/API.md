# API — FeedSure CBG

Base URL: `${VITE_API_BASE_URL}` (API Gateway HTTP API). All bodies are JSON. Dates are
`YYYY-MM-DD` in Asia/Kolkata. Weights are kg (numbers). Distances are km and times are minutes.

## Auth model (hackathon-grade, see SECURITY.md)
- **Generator endpoints** require the generator's `token` (query param or body field).
- **Plant endpoints** require the header `X-Admin-Token: <ADMIN_TOKEN>`.

## Error format (all endpoints)
```json
{ "error": { "code": "INVALID_INPUT", "message": "reportedKg must be between 0 and 5000" } }
```
| HTTP | code |
|---|---|
| 400 | `INVALID_INPUT` |
| 401 | `UNAUTHORIZED` (bad token or admin token) |
| 404 | `NOT_FOUND` |
| 409 | `PHOTO_MISSING` (S3 object not found) |
| 413 | `PHOTO_TOO_LARGE` |
| 502 | `UPSTREAM_FAILED` (only when no graceful fallback exists) |
| 500 | `INTERNAL` |

---

## GET /generators/{generatorId}?t={token}
Public profile for the generator page.
```json
200 { "generatorId": "hostel-3", "name": "Hostel 3 Mess", "type": "hostel_mess",
      "pickupWindow": { "start": "06:30", "end": "09:00" }, "defaultLang": "hi" }
```

## GET /generators  (admin)
```json
200 { "generators": [ { "generatorId": "hostel-3", "name": "Hostel 3 Mess", "type": "hostel_mess",
      "lat": 12.97, "lng": 77.59, "pickupWindow": {"start":"06:30","end":"09:00"},
      "priorAccept": 0.7, "priorContamPct": 2, "avgKgByWeekday": [120,130,125,128,140,90,80] } ] }
```

## POST /uploads
Request:
```json
{ "generatorId": "hostel-3", "token": "…", "contentType": "image/jpeg" }
```
Response: two presigned POSTs (5 minutes, `content-length-range` 1 KB–3.5 MB, JPEG/PNG only).
```json
200 { "uploads": [
  { "slot": "top",  "key": "submissions/hostel-3/2026-10-09/ab12-top.jpg",  "url": "https://…", "fields": { … } },
  { "slot": "tray", "key": "submissions/hostel-3/2026-10-09/ab12-tray.jpg", "url": "https://…", "fields": { … } }
] }
```
An unknown generator returns `404 NOT_FOUND`; an invalid generator token returns
`401 UNAUTHORIZED`.

## POST /submissions
Request:
```json
{ "generatorId": "hostel-3", "token": "…", "reportedKg": 125,
  "photoKeys": ["submissions/hostel-3/2026-10-09/ab12-top.jpg",
                "submissions/hostel-3/2026-10-09/ab12-tray.jpg"],
  "lang": "hi" }
```
Validation: `reportedKg` 0–5000; exactly 2 keys under `submissions/{generatorId}/`; `lang` ∈ `en|hi`
(`kn` is stretch).

Response:
```json
200 { "submissionId": "hostel-3#2026-10-09T18:42:10Z",
      "date": "2026-10-09",
      "verdict": "HOLD",
      "reason": "over_threshold",
      "instruction": "Remove the 3 plastic wrappers and photograph again.",
      "observations": { "items": [{"type":"plastic_wrapper","count":3,"confidence":0.91}],
                        "visibleContaminantPct": 8, "hazard": false,
                        "imageQuality": "ok", "confidence": 0.82,
                        "notes": "Several plastic wrappers are visible." },
      "modelId": "…", "screenedAt": "2026-10-09T18:42:10Z" }
```

## GET /submissions?date=YYYY-MM-DD  (admin)
Returns the latest submission per generator for the date, plus `photoUrls` (presigned GET, 5 minutes).
```json
200 { "date": "2026-10-09", "submissions": [ { "generatorId": "hostel-3", "verdict": "HOLD",
      "reason": "over_threshold", "reportedKg": 125, "visibleContaminantPct": 8,
      "instruction": "…", "photoUrls": ["https://…","https://…"], "screenedAt": "…" } ] }
```

## POST /plans  (admin)
Request (all optional except `date`; defaults come from config):
```json
{ "date": "2026-10-10", "targetKg": 1800, "truckCapacityKg": 2000 }
```
Response:
```json
200 {
  "planId": "2026-10-10#p-7f3a", "date": "2026-10-10", "simulated": true,
  "matrixSource": "location",
  "params": { "targetKg": 1800, "truckCapacityKg": 2000, "shiftStart": "06:00",
              "shiftEnd": "11:00", "serviceMin": 10, "maxRadiusKm": 15 },
  "plan": {
    "stops": [ { "seq": 1, "generatorId": "hotel-a", "arrive": "06:24", "depart": "06:34",
                 "forecastKg": 260, "usableKg": 240.5, "verdict": "ACCEPT", "cumLoadKg": 260 } ],
    "totalKm": 38.4, "totalMin": 212, "loadKg": 1910,
    "usableKg": 1742.1, "usableKgPerKm": 45.4, "wastedStops": 0,
    "geometry": null
  },
  "baseline": { "stops": [ … ], "totalKm": 41.0, "loadKg": 1980, "usableKg": 1490.3,
                "usableKgPerKm": 36.3, "wastedStops": 1 },
  "shortfall": { "kg": 57.9, "targetMet": false,
                 "reasons": [ { "code": "held", "kg": 115.0, "generatorIds": ["hostel-3"] } ] },
  "excluded": [ { "generatorId": "hostel-3", "code": "held" } ]
}
```
`geometry` is optional (stretch: route polyline). Without it, the frontend draws straight segments
between stops.

## GET /plans/{date}  (admin)
Returns the latest stored plan for the date (same shape as above) or 404.

## Stretch: POST /gate-logs  (admin)
```json
{ "date": "2026-10-10", "generatorId": "hotel-a", "outcome": "ACCEPTED|SORTED|REJECTED", "actualKg": 250 }
```
