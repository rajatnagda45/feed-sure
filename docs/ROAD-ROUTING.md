# Road routing and map geometry

The map previously drew a `LineString` from plant and stop coordinates. OpenStreetMap tiles provided the background only; they did not calculate routes. The local demo also forced the haversine × road-factor matrix, so distance/time estimates did not follow road access or one-way travel.

## Behavior

- Local demos now default to OSRM road routing. Its directional table distances and durations feed both the primary planner and the fair baseline, including capacity, windows, shift and depot-return checks. Unreachable matrix legs remain unavailable, not fabricated aerial travel.
- The planner still selects and orders stops. A subsequent route request obtains the road geometry for exactly that order, including return to the depot. Geometry is stored with the draft and retained at dispatch; later supplier changes do not redraw a frozen trip using new coordinates.
- The map draws only validated provider geometry as a solid road path. If road geometry is absent or invalid, it shows markers and a clear warning with no straight connecting lines. Existing plans need re-planning to obtain geometry.
- AWS uses `CalculateRouteMatrix` and `CalculateRoutes` with the Truck travel mode. The SAM operational function includes both permissions. This change has not been deployed to AWS.
- OSRM uses its driving profile. It is a road-network demonstration, not verification of truck height/weight restrictions or live traffic. The public service has best-effort availability. Stop order is heuristic and constrained, not a claim of a globally shortest route.

## Configuration

`ROUTING_PROVIDER=auto` preserves existing non-demo behavior: `MOCK_LOCATION=true` means labelled fallback estimates, otherwise AWS Location. Explicit values are `location`, `osrm` or `fallback`. `OSRM_BASE_URL` can point at an operator's own compatible service; default is `https://router.project-osrm.org`. `ROUTING_TIMEOUT_SECONDS` bounds OSRM and AWS geometry requests (default 6 seconds).

`python scripts/local_demo.py --routing-provider osrm` sends demo coordinates to the configured routing server, but no names, tokens or photographs. Use `--routing-provider fallback` for an offline demo. Basemap selection is independent. An OSM/AWS basemap does not establish successful road routing; check the plan's matrix source and geometry status.

Road-provider failures return an explicitly labelled fallback matrix and unavailable geometry. Failed provider responses are not cached as successful road matrices. Cached matrices include provider, endpoint/profile, coordinates and point ordering in their identity. Geometry requests are bounded and responses exceeding the storage budget are rejected, not simplified into misleading straight connections.

## Additive API fields

`matrixSource` and `serviceMode.matrix` additionally accept `osrm`. Plan envelopes now have optional `roadRoute`:

```json
{
  "status": "ready",
  "source": "osrm",
  "profile": "driving",
  "geometry": { "type": "MultiLineString", "coordinates": [] }
}
```

The empty coordinates above illustrate the structure only; ready geometry requires at least one valid line with at least two longitude/latitude pairs. AWS legs remain separate lines to avoid invented connections across leg gaps. Failure uses `status: "unavailable"` and `geometry: null`. Older plans without this field remain readable. No table key or dispatch revision behavior changed.

## Verification

On the mapped synthetic local demo dated 12 October 2026, a real OSRM-backed plan selected five stops, reported 42.1258 km and returned 809 road-path coordinates. This is a reproducible integration example, not an observed collection trip. Public routing results can change as road data changes.

The actual browser rendered the solid path along roads on the OSM basemap and showed the same 42.1 km route summary. Dispatch preserved the exact geometry. Screenshot: [road path](evidence/road-routing/road-path.png). The verification used separate local ports 8796/5186; existing demo databases and shared checkouts were preserved.

348 backend tests and 104 frontend tests passed; three opt-in live frontend tests were skipped. Production build passed with existing large-chunk warnings; the existing Starlette/httpx warning remains. Focused coverage includes asymmetric distances, unreachable legs, malformed provider data, timeout fallback, stop order and depot return, AWS leg separation, geometry limits and geometry updates when marker coordinates are unchanged. Live AWS and physical truck access remain unverified.

Provider references: [OSRM API](https://project-osrm.org/docs/v5.24.0/api/) and [Amazon Location CalculateRoutes](https://docs.aws.amazon.com/location/latest/APIReference/API_CalculateRoutes.html).
