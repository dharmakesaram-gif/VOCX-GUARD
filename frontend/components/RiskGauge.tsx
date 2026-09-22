'use client';

import React from 'react';

interface RiskGaugeProps {
  score: number; // 0 to 1
  size?: number;
}

export default function RiskGauge({ score, size = 200 }: RiskGaugeProps) {
  const normalizedScore = Math.min(Math.max(score, 0), 1);
  
  // Determine color based on score aligned with backend (<0.30 LOW, <0.70 MEDIUM, >=0.70 HIGH)
  let color = '#00ff88'; // cyber-emerald
  let glowColor = 'rgba(0, 255, 136, 0.5)';
  let label = 'LOW RISK';
  
  if (normalizedScore >= 0.70) {
    color = '#ff0055'; // cyber-crimson
    glowColor = 'rgba(255, 0, 85, 0.5)';
    label = 'HIGH RISK';
  } else if (normalizedScore >= 0.30) {
    color = '#ffaa00'; // cyber-amber
    glowColor = 'rgba(255, 170, 0, 0.5)';
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
