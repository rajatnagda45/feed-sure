# Landing-page media

The landing page uses three original AI-generated illustrative scenes and an 18-second silent MP4 explaining readiness, collection and reconciliation. These scenes are not actual pilot photographs or footage. No production screens, credentials, physical people or customer images were used as inputs.

## Assets and delivery

All delivered media lives in `frontend/public/media/`:

| Asset | Bytes | Purpose |
| --- | ---: | --- |
| `kitchen-ready.webp` | 88,768 | Hero image and first film scene |
| `collection.webp` | 118,386 | Video poster and second film scene |
| `plant-intake.webp` | 156,170 | Third film scene |
| `collection-workflow.mp4` | 490,365 | 1280 × 720, H.264/yuv420p, 24 fps, 18 seconds, no audio |
| `collection-workflow.en.vtt` | 421 | English captions |

Images are WebP encodings of generated PNG originals. Total shipped media is under 855 KB (decimal). Video uses native controls, inline playback, no autoplay and `preload="none"`. A static poster and adjacent explanatory text remain useful without playing it. A collapsible transcript describes the visuals and full workflow. The hero has descriptive alternative text. No third-party media hosts, trackers or runtime dependencies were introduced. Reduced-motion users receive nonanimated anchor scrolling; video only moves after user-initiated playback.

## Provenance and generation prompts

Generated on 11 October 2026 with OpenAI's built-in image generation tool, one call per asset. No reference images were supplied. The original PNGs remain in the generating workspace's Codex generated-images directory; optimized project copies are committed above. FFmpeg performed format/size encoding and assembled the still-image video; it is not camera footage or a generated moving scene.

### Kitchen image

Use-case: editorial website hero photo illustration for FeedSure, a kitchen food-waste collection coordination app in India. Create one photorealistic wide landscape photograph, 16:9 composition. Scene: clean Indian institutional commercial kitchen, stainless steel counter and background, anonymous worker cropped at shoulders wearing muted forest-green apron and food handling gloves carefully transferring vegetable peelings and preparation offcuts from a steel tray into a clean open dark green food-waste collection bin in foreground. Hands anatomically natural, believable modest working kitchen, soft morning daylight, deep forest-green and warm neutral palette, premium documentary editorial photography, natural grain, subtle depth of field. Frame close enough to clearly understand separated vegetable scraps; bin and hands center right, countertop visible left. Show only peelings and cut stems, no prepared edible meals. No faces, no text, no logos, no watermark, no screen interfaces, no claims or numbers. This is an illustrative staged scene, not a photograph of an actual pilot. Output a polished web-ready landscape composition.

### Collection image

Photorealistic editorial landscape image for a food-waste collection coordination website in India, 16:9. An anonymous municipal-style collection worker in plain muted green uniform and gloves, cropped or viewed from behind without identifiable face, moving a CLOSED dark green wheeled food-waste bin beside a compact white enclosed light commercial collection truck with green lower body. Service courtyard of an Indian institutional kitchen, modest clean functional architecture, paving, a few trees, soft morning daylight. Vehicle is safely parked, rear loading area sensible and believable, all waste contained with no mess. Forest green and warm neutral palette, quiet premium documentary composition, truck on right and worker/bin center. No logos, text, readable license plates, dashboards, statistics, or watermarks. Illustrative staged scene, not actual pilot footage.

### Plant image

Create a premium photorealistic editorial landscape illustration 16:9 for FeedSure, an Indian food-waste collection coordination product. Subject: a compact white light commercial food-waste collection truck with dark green lower panels safely stationary on a realistic flat industrial weighbridge at the receiving gate of a modest Indian biogas facility. Three-quarter rear side view, enclosed cargo body, sensible scale, weighbridge steel deck obvious in foreground, small intake office to left and low industrial green digesters softly visible in far background, landscaped trees, soft warm morning daylight, understated forest green and cream palette, documentary photography aesthetic. No identifiable people, no readable plate, no logos, no lettering, no numerical readout, no fake UI, no watermark. Clean believable working site, no futuristic architecture, no chimneys/smoke, no claims about gas output or emissions. This is an illustrative scene, not actual pilot footage. Truck and receiving infrastructure are the focal point.

## Rebuilding the film

Run `python scripts/build_workflow_video.py --ffmpeg <local-ffmpeg-executable> --font <local-font-file>` from the repository. The generation run used FFmpeg 7.1 from the temporary `imageio-ffmpeg==0.6.0` build tool and Windows Segoe UI. Neither package nor font binary is a shipped application dependency. Each image is shown for six seconds with short fades and explanatory text. Different font/encoder versions can produce different bytes.

## Original media validation

- Frontend: 58 passed, three opt-in live tests skipped; production build passed. Existing MapLibre bundle-size warning remains.
- Backend: 275 passed with the existing Starlette/httpx deprecation warning.
- Browser: image decoded at 1280 pixels; video initially paused with readyState 0, then keyboard playback reached all 18 seconds at 1280 × 720. English captions displayed and the transcript expanded.
- Responsive checks: 1440, 390 and 320 pixel iframe viewports had matching document/client widths (no horizontal page overflow). Desktop hero evidence is `docs/evidence/frontend-design/media-hero.png`.
- These browser checks used the original isolated design branch. No deployment or shared demo reseeding was performed.

## Follow-up PR validation

The media commit was applied to main at `f2eb064`, preserving its waste-supplier, admin, plant-owner and driver navigation. On this updated branch, 82 frontend tests and 286 backend tests passed; three opt-in live frontend tests were skipped. The production build passed. The existing MapLibre bundle-size and Starlette/httpx warnings remain. The screenshot above records the original media preview, before the newer navigation was incorporated.
