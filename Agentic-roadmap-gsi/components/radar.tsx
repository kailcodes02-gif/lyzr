"use client";

export interface RadarPoint {
  label: string;
  score: number;
  color: string;
}

export function Radar({ points, size = 320 }: { points: RadarPoint[]; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.4;
  const n = points.length;

  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const at = (i: number, radius: number): [number, number] => [
    cx + radius * Math.cos(angle(i)),
    cy + radius * Math.sin(angle(i)),
  ];

  const rings = [0.25, 0.5, 0.75, 1];
  const gridPolys = rings.map((r) =>
    points.map((_, i) => at(i, R * r).join(",")).join(" "),
  );
  const dataPoly = points
    .map((p, i) => at(i, R * Math.max(0.04, p.score / 100)).join(","))
    .join(" ");

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full overflow-visible">
      {/* grid rings */}
      {gridPolys.map((poly, idx) => (
        <polygon
          key={idx}
          points={poly}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={1}
          opacity={idx === gridPolys.length - 1 ? 0.9 : 0.5}
        />
      ))}
      {/* axes */}
      {points.map((_, i) => {
        const [x, y] = at(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--color-border)" strokeWidth={1} opacity={0.5} />;
      })}
      {/* data polygon */}
      <polygon points={dataPoly} fill="rgba(201,106,90,0.14)" stroke="var(--color-accent)" strokeWidth={2} />
      {/* vertices */}
      {points.map((p, i) => {
        const [x, y] = at(i, R * Math.max(0.04, p.score / 100));
        return <circle key={i} cx={x} cy={y} r={3.5} fill={p.color} stroke="var(--color-surface)" strokeWidth={1.5} />;
      })}
      {/* labels */}
      {points.map((p, i) => {
        const [lx, ly] = at(i, R + 16);
        const dx = lx - cx;
        const anchor = dx < -6 ? "end" : dx > 6 ? "start" : "middle";
        return (
          <text
            key={i}
            x={lx}
            y={ly}
            textAnchor={anchor}
            dominantBaseline="middle"
            className="font-display"
            fontSize={11}
            fill="var(--color-muted)"
          >
            {p.label}
          </text>
        );
      })}
    </svg>
  );
}
