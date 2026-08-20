export function CountdownRing({ secondsRemaining, totalSeconds }: { secondsRemaining: number; totalSeconds: number }) {
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const fraction = totalSeconds > 0 ? Math.max(0, secondsRemaining) / totalSeconds : 0;
  const dashoffset = circumference * (1 - fraction);
  const urgent = secondsRemaining <= 3;

  return (
    <div className="countdown-ring-wrap">
      <svg width="160" height="160" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r={radius} fill="none" stroke="#2A313C" strokeWidth="10" />
        <circle
          cx="80" cy="80" r={radius} fill="none"
          stroke={urgent ? '#F1636B' : '#4C7BFF'}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          transform="rotate(-90 80 80)"
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 300ms' }}
        />
      </svg>
      <div className="countdown-number">{Math.max(0, secondsRemaining)}</div>
    </div>
  );
}
