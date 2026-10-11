# Browser camera photos

On a supplier's `/g/:id` page, **Take photo** opens an inline live browser preview, preferring
the rear camera without requiring one. The browser requests camera permission (video only,
no microphone), then optional location permission. **Capture photo** produces a JPEG preview;
the user can retake, remove or upload it after saving readiness. Nothing uploads automatically.
**Upload an existing photo instead** is a collapsed secondary option for JPEG/PNG files.

Camera images have an appended footer containing the supplier ID, device UTC capture time,
and the most recent valid GPS fix with reported accuracy. A fix must be within 30 seconds of
capture; denied, invalid, unavailable or stale location is explicitly unknown and never blocks
capture. The footer remains in actual private stored image bytes, including evidence retrieval,
without adding API fields or changing table keys. Existing images keep their contents and are
not labelled with a present-day capture time or location. No authenticity or geofence claim is made.

Camera and GPS start only after opening the preview, and stop after successful capture, close,
leaving the page, hiding the tab or camera disconnection. A delayed permission grant after closing
is released. Camera errors give a close/reopen retry and existing-image fallback. Location errors
leave capture available. English and Hindi controls and permission explanations are provided.

Browser camera and geolocation require a secure context: use HTTPS in hosting or localhost for
local development. A phone accessing a LAN HTTP address cannot use these APIs. Embedded hosting
must permit camera and geolocation for the app origin. See browser documentation for
[getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) and
[watchPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition).

## Verification

- `npm run test`: permission denial, late permission/cancellation, resource cleanup including
  watch ID zero, camera disconnection, unsupported/insecure contexts, missing GPS, stale/future/
  invalid fixes, accuracy preservation, tagged JPEG canvas and primary/secondary control order.
- `npm run build`: strict TypeScript and production bundling.
- `python -m pytest -q`: existing backend regression suite, including real photo handlers.

On 11 October 2026, **82 frontend tests passed** (3 opt-in API-client tests skipped),
**280 backend tests passed**, and the production build passed. Headless Chrome with a
deterministic 640×480 synthetic video and scripted GPS verified the 390 px preview, actual
JPEG upload through real local handlers/Moto, persisted retrieval after reload, camera/GPS
cleanup, denied location capture, denied camera fallback and no horizontal page overflow.
The browser check also identified a 2×2 placeholder frame; capture now waits for useful
frame dimensions. The normal headless fake-device feed was replaced with synthetic Y4M
video to verify full-resolution pixels. This is simulated device evidence, not a field test.

The [retrieved JPEG](evidence/browser-camera/tagged-synthetic.jpg) shows the synthetic video
pattern and the retained supplier/device-time/GPS-accuracy footer. Its coordinates are test
inputs, not an observed person or supplier location. Private access tokens are excluded.

Physical phone cameras/GPS, hosted HTTPS permissions, live AWS and live Bedrock require device
and deployment verification. Automated fake-camera results must be labelled simulated.
