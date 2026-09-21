'use client';

import React from 'react';

interface RiskGaugeProps {
  score: number; // 0 to 1
  size?: number;
}

export default function RiskGauge({ score, size = 200 }: RiskGaugeProps) {
  const normalizedScore = Math.min(Math.max(score, 0), 1);
  
  // Determine color based on score
  let color = '#00e676'; // success (green)
  let glowColor = 'rgba(0, 230, 118, 0.5)';
  let label = 'LOW RISK';
  
  if (normalizedScore >= 0.50) {
    color = '#ff3b3b'; // danger (red)
    glowColor = 'rgba(255, 59, 59, 0.5)';
    label = 'HIGH RISK';
  } else if (normalizedScore >= 0.35) {
    color = '#ffb800'; // warning (yellow)
    glowColor = 'rgba(255, 184, 0, 0.5)';
    label = 'MEDIUM RISK';
  }

  const strokeWidth = size * 0.1;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  // Arc represents 75% of a circle (270 degrees)
  const arcLength = circumference * 0.75;
  const dashOffset = arcLength - (normalizedScore * arcLength);

  return (
    <div className="flex flex-col items-center relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(135deg)' }}
      >
        {/* Background Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#1f2937" // gray-800
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${arcLength} ${circumference}`}
        />
        {/* Value Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeDashoffset={dashOffset}
          className="transition-all duration-1000 ease-out"
          style={{ filter: `drop-shadow(0 0 8px ${glowColor})` }}
        />
      </svg>
      
      {/* Center Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center transform -translate-y-4">
        <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1">Risk Score</span>
        <span className="text-4xl font-bold font-mono" style={{ color }}>
          {(normalizedScore * 100).toFixed(0)}
        </span>
        <span className="text-xs font-bold mt-2 px-2 py-1 rounded bg-gray-800/80 border" style={{ borderColor: color, color }}>
          {label}
        </span>
      </div>
    </div>
  );
}
