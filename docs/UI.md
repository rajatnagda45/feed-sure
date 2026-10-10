# UI — FeedSure CBG

There are two very different users, so there are two very different surfaces:

- `/g/:generatorId`: phone, kitchen, wet hands, possibly Hindi. **One question per screen.**
- `/plant`: laptop, planning tomorrow. **Dense, numeric, calm.**
- `/`: a short landing page for judges with links to both (the demo generator link and the dashboard).

## 1. Design direction

The visual language comes from India's municipal waste system: the **green wet-waste bin** and the
**blue dry-waste bin**, plus the colour logic of a traffic signal at the bin. This is not decoration:
kitchen staff already associate green with wet waste, and the verdict colours map to "go / check / stop".

| Token | Hex | Use |
|---|---|---|
| `--bin-green` | `#1E7B3C` | brand, primary buttons, ACCEPT |
| `--dry-blue` | `#1F4E99` | links, route line on the map, focus ring |
| `--amber` | `#B86A00` | INSPECT |
| `--stop-red` | `#C0262D` | HOLD, shortfall |
| `--asphalt` | `#25292D` | text |
| `--steel` | `#E7EBE8` | surfaces, table stripes |
| `--white` | `#FFFFFF` | page background |

Status is never shown by colour alone: always colour + word + icon (✓ / ? / ✕).

**Type:** Noto Sans for Latin text, with Noto Sans Devanagari and Noto Sans Kannada (stretch) in the
same font stack, so Hindi instructions render properly. On the dashboard use `font-variant-numeric:
tabular-nums` so kg and km columns align. One family only. The scale is 14 / 16 / 20 / 28 / 44 px,
with weights 400 and 700 only.

**The one bold moment:** the verdict screen on the phone. A full-bleed colour field, the verdict word
at about 44 px in the chosen language, and the instruction below it at 20 px. Everything else in the
app stays quiet. No decorative gradients, no card grids, no tracked-out uppercase labels, no motion
except the verdict reveal (a 200 ms fade, disabled under `prefers-reduced-motion`).

Corners: 6 px on buttons and inputs only. Tables and the map are square.

## 2. Generator flow (`/g/:generatorId?t=…`), mobile-first at 360–420 px

```
[1 Weight]        [2 Top photo]       [3 Tray photo]      [4 Checking…]     [5 Verdict]
Hostel 3 Mess     Photo of the bin    Spread a handful    Spinner +         ███ HOLD ███
How many kg       from above.         on a tray and       "Checking your    Remove the 3
today?            (outline guide)     take a photo.       photos"           plastic wrappers
[ 125 ] kg                                                                  and photograph again.
[ −10 ][ +10 ]    [Take photo]        [Take photo]                          [Photograph again]
[Next]            [Retake][Use this]  [Retake][Use this]                    [Done]
```

- Step 1: a numeric input (`inputmode="numeric"`) with ±10 buttons, prefilled with the weekday average.
- Steps 2–3: `<input type="file" accept="image/*" capture="environment">`. Show a preview with
  **Retake / Use this photo**, and resize on the client before upload (canvas, JPEG 0.8, ≤ 1280 px).
- Step 4: a progress line; after 20 s, show "Still checking…".
- Step 5: the verdict field in its colour, the instruction, and the detected items as a short list
  ("3 plastic wrappers"). HOLD/INSPECT → primary button **Photograph again** (back to step 2, weight
  kept). ACCEPT → **Done** with "Ready for pickup tomorrow."
- A language switch at the top (EN / हिंदी) sets `lang`, defaulting to the generator's `defaultLang`.
- Touch targets ≥ 48 px. Buttons sit at the bottom of the screen in thumb reach.

**Errors (say what happened and what to do):**
- Upload failed → "Photo didn't upload. Check your internet and tap Try again."
- Bad link → "This link isn't valid. Ask the plant for your FeedSure link."
- Screening failed → INSPECT screen: "We couldn't check this photo. A plant staff member will check it at pickup."

## 3. Plant dashboard (`/plant`), desktop-first at ≥ 1200 px, usable at 1024 px

On first visit, prompt for the admin token and keep it in `sessionStorage`.

```
┌ FeedSure · Plan for Sat 10 Oct ─────────────── Simulated data ┐
│ Target [1700] kg  Truck [2000] kg   [Re-plan]                   │
├──────────────────────────────┬──────────────────────────────────┤
│                              │ Usable 1,742 kg of 1,700 target  │
│           MAP                │ 38.4 km · 45.4 kg/km · 0 wasted  │
│  plant ◆, stops ①②③ in blue │ ─ Shortfall banner (red) if any ─│
│  held generators ✕ in grey   │ Route                            │
│                              │ 1 06:24 Hotel A   260→240 ✓      │
│                              │ 2 06:51 Hostel 1  130→121 ✓      │
├──────────────────────────────┴──────────────────────────────────┤
│ FeedSure vs nearest-first   usable kg · km · kg/km · wasted     │
├─────────────────────────────────────────────────────────────────┤
│ Today's photo checks   name · kg · verdict · contam % · photos  │
└─────────────────────────────────────────────────────────────────┘
```

- **Map:** MapLibre with the Amazon Location v2 style (API key). The plant is a diamond; stops are
  numbered blue circles joined in route order; excluded generators are grey with ✕ and a tooltip
  showing the reason. If the map fails, fall back to an SVG scatter of the same points (no tiles).
- **KPI strip:** large tabular numbers. The headline is **usable kg per km**.
- **Shortfall banner** (only when `shortfall.kg > 0`): "Short by 58 kg. Hostel 3 is on hold
  (115 kg). Ask them to resend photos or add a stop." Build the sentence from the reason codes.
- **Comparison table:** two rows, FeedSure and nearest-first; the better cell in each column is bold.
- **Photo checks table:** the latest per generator, with the verdict chip (colour + word + icon) and
  two thumbnails that open full size. Poll every 10 s while the tab is visible, so phone submissions
  appear live during the demo.
- Re-plan shows a spinner in the button only. Keep the old plan visible until the new one arrives,
  then highlight changed stops for 2 s.

## 4. Copy rules
- Plain verbs, sentence case: "Take photo", "Photograph again", "Re-plan". No "Submit".
- Units are always shown: "125 kg", "38.4 km", "06:24".
- Wherever numbers come from seeded data, show a small "Simulated data" tag in the header.

## 5. Accessibility
Contrast ≥ 4.5:1 for text; visible focus ring (2 px `--dry-blue`); every input has a label; images
have alt text ("Top view of bin"); the verdict is announced with `aria-live="polite"`; respect
`prefers-reduced-motion`.

## 6. Strings
Keep all UI strings in `frontend/src/i18n.ts` as `{ en: {...}, hi: {...} }`. The verdict instruction
comes from the API already translated. Have a native speaker check the Hindi strings before recording.
