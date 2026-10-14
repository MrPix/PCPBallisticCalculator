"use client";

const WIDTH = 360;
const HEIGHT = 210;
const PAD_LEFT = 40;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 30;

export interface ChartPoint {
  x: number;
  y: number;
}

function niceStep(span: number, targetLines: number): number {
  const raw = span / targetLines;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (magnitude * factor >= raw) return magnitude * factor;
  }
  return magnitude * 10;
}

/**
 * Dependency-free SVG chart.
 * Plots angular drop (mrad) or linear drop (cm) against distance.
 */
export function TrajectoryChart({
  points,
  markers = [],
  markerX,
  markerY,
  maxDistanceM,
  yUnit,
}: {
  points: ChartPoint[];
  /** Raw measured points drawn as dots under the curve. */
  markers?: ChartPoint[];
  markerX: number;
  markerY: number;
  maxDistanceM: number;
  yUnit: string;
}) {
  if (points.length < 2) {
    return <p className="py-6 text-center text-sm text-muted">Nothing to plot.</p>;
  }

  const yValues = points.map((p) => p.y);
  const rawMin = Math.min(...yValues, 0);
  const rawMax = Math.max(...yValues, 0);
  const pad = Math.max((rawMax - rawMin) * 0.08, 0.5);
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;

  const xScale = (x: number) => PAD_LEFT + (x / maxDistanceM) * (WIDTH - PAD_LEFT - PAD_RIGHT);
  const yScale = (y: number) =>
    PAD_TOP + (1 - (y - yMin) / (yMax - yMin)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`)
    .join(" ");

  const yStep = niceStep(yMax - yMin, 4);
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax + 1e-9; v += yStep) yTicks.push(v);

  const xStep = niceStep(maxDistanceM, 5);
  const xTicks: number[] = [];
  for (let v = xStep; v <= maxDistanceM + 1e-9; v += xStep) xTicks.push(v);

  const markerInside = markerX >= 0 && markerX <= maxDistanceM && Number.isFinite(markerY);
  const visibleMarkers = markers.filter(
    (m) => Number.isFinite(m.y) && m.x >= 0 && m.x <= maxDistanceM,
  );

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Drop in ${yUnit} against distance`}
    >
      {yTicks.map((v) => (
        <g key={`y${v}`}>
          <line
            x1={PAD_LEFT}
            x2={WIDTH - PAD_RIGHT}
            y1={yScale(v)}
            y2={yScale(v)}
            stroke="var(--line)"
            strokeWidth={Math.abs(v) < 1e-9 ? 1.4 : 0.6}
          />
          <text
            x={PAD_LEFT - 6}
            y={yScale(v) + 3.5}
            textAnchor="end"
            fontSize="9"
            fill="var(--muted)"
            className="nums"
          >
            {Math.abs(v) < 1e-9 ? "0" : v.toFixed(v < 10 && yStep < 1 ? 1 : 0)}
          </text>
        </g>
      ))}

      {xTicks.map((v) => (
        <g key={`x${v}`}>
          <line x1={xScale(v)} x2={xScale(v)} y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM} stroke="var(--line)" strokeWidth={0.6} />
          <text
            x={xScale(v)}
            y={HEIGHT - PAD_BOTTOM + 12}
            textAnchor="middle"
            fontSize="9"
            fill="var(--muted)"
            className="nums"
          >
            {v}
          </text>
        </g>
      ))}

      <text x={PAD_LEFT} y={HEIGHT - 4} fontSize="9" fill="var(--muted)">
        distance (m)
      </text>
      <text x={PAD_LEFT - 34} y={PAD_TOP + 8} fontSize="9" fill="var(--muted)">
        {yUnit}
      </text>

      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2.2} strokeLinejoin="round" />

      {visibleMarkers.map((m) => (
        <circle
          key={`measured-${m.x}`}
          cx={xScale(m.x)}
          cy={yScale(m.y)}
          r={3.4}
          fill="var(--good)"
          opacity={0.9}
        />
      ))}

      {markerInside && (
        <g>
          <line
            x1={xScale(markerX)}
            x2={xScale(markerX)}
            y1={PAD_TOP}
            y2={HEIGHT - PAD_BOTTOM}
            stroke="var(--fg)"
            strokeWidth={0.8}
            strokeDasharray="3 3"
            opacity={0.55}
          />
          <circle cx={xScale(markerX)} cy={yScale(markerY)} r={4.5} fill="var(--fg)" stroke="var(--accent)" strokeWidth={2} />
        </g>
      )}
    </svg>
  );
}
