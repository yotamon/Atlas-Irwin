export function Sparkline({
  values,
  label,
}: {
  values: number[];
  label: string;
}) {
  if (!values.length) {
    return <div className="sparkline empty" aria-label={`${label}: no data`} />;
  }
  const width = 120;
  const height = 36;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  const last = values[values.length - 1] ?? 0;
  return (
    <div className="sparkline" aria-label={`${label}: ${last.toLocaleString()}`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
      </svg>
    </div>
  );
}
