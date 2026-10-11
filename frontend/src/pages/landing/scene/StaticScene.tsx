import { PALETTE } from "./palette";

/** Code-generated SVG fallback used for reduced-motion users, while the 3D
 *  chunk loads, and when WebGL is unavailable. Fully drawn from code — no
 *  raster image. Isometric projection of the same kitchen → plant journey. */
export function StaticScene() {
  return (
    <svg
      className="fs-scene__static"
      viewBox="0 0 680 460"
      role="img"
      aria-label="Isometric diagram of the FeedSure collection journey: a supplier kitchen, a winding collection route, a pickup stop and a CBG plant."
    >
      <defs>
        <linearGradient id="fs-ss-roof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={PALETTE.sage} />
          <stop offset="1" stopColor={PALETTE.forest} />
        </linearGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx="340" cy="420" rx="300" ry="26" fill={PALETTE.deep} opacity="0.08" />

      {/* winding route */}
      <path
        d="M110 350 C 220 330 250 250 330 250 S 470 210 520 150"
        fill="none"
        stroke={PALETTE.sage}
        strokeWidth="22"
        strokeLinecap="round"
        opacity="0.35"
      />
      <path
        d="M110 350 C 220 330 250 250 330 250 S 470 210 520 150"
        fill="none"
        stroke={PALETTE.lime}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="4 10"
      />

      {/* Stage 1 — kitchen */}
      <g transform="translate(70 250)">
        <polygon points="0,40 55,12 110,40 55,68" fill="url(#fs-ss-roof)" />
        <polygon points="0,40 0,95 55,123 55,68" fill="#e6e4d8" />
        <polygon points="110,40 110,95 55,123 55,68" fill="#d7d5c8" />
        <rect x="18" y="62" width="14" height="18" fill={PALETTE.warm} opacity="0.85" transform="skewY(27)" />
        <polygon points="-16,70 4,62 4,86 -16,94" fill={PALETTE.truck} />
      </g>

      {/* Stage 3 — pickup stop */}
      <g transform="translate(300 215)">
        <polygon points="0,26 38,8 76,26 38,44" fill="url(#fs-ss-roof)" />
        <polygon points="0,26 0,64 38,82 38,44" fill="#e6e4d8" />
        <polygon points="76,26 76,64 38,82 38,44" fill="#d7d5c8" />
      </g>

      {/* Stage 4 — CBG plant */}
      <g transform="translate(470 110)">
        <ellipse cx="34" cy="78" rx="30" ry="14" fill="#d9d8cc" />
        <path d="M10 78 v-34 a24 10 0 0 1 48 0 v34 a24 10 0 0 1 -48 0Z" fill={PALETTE.metal} />
        <path d="M10 44 a24 10 0 0 1 48 0 a24 16 0 0 0 -48 0Z" fill={PALETTE.forest} />
        <path d="M70 70 v-24 a16 7 0 0 1 32 0 v24 a16 7 0 0 1 -32 0Z" fill={PALETTE.metalDark} />
        <path d="M70 46 a16 7 0 0 1 32 0 a16 11 0 0 0 -32 0Z" fill={PALETTE.forest} />
        <rect x="112" y="6" width="9" height="60" fill={PALETTE.metal} />
        <circle cx="116" cy="4" r="6" fill={PALETTE.lime} />
      </g>

      {/* numbered waypoints */}
      {[
        [110, 350, "1"],
        [300, 250, "2"],
        [360, 236, "3"],
        [540, 150, "4"],
      ].map(([x, y, n]) => (
        <g key={n as string} transform={`translate(${x} ${y})`}>
          <circle r="13" fill={PALETTE.forest} />
          <text textAnchor="middle" dy="4.5" fontSize="13" fontWeight="700" fill={PALETTE.ivory}>
            {n}
          </text>
        </g>
      ))}
    </svg>
  );
}
