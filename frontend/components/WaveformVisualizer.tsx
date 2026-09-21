'use client';

import React, { useEffect, useRef } from 'react';

interface WaveformVisualizerProps {
  isActive: boolean;
  audioData?: number[];
}

export default function WaveformVisualizer({ isActive, audioData }: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let phase = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      const numBars = 50;
      const barWidth = (width / numBars) - 2;

      for (let i = 0; i < numBars; i++) {
        const x = i * (barWidth + 2);
        
        let barHeight = 2; // Default resting height
        
        if (isActive) {
          if (audioData && audioData.length > 0) {
            // Use real data if provided
            const dataIndex = Math.floor((i / numBars) * audioData.length);
            barHeight = Math.max(2, (audioData[dataIndex] / 255) * height);
          } else {
            // Generate fake animated data
            const frequency = i / numBars * Math.PI * 4;
            const noise = Math.random() * 0.3;
            const amplitude = Math.sin(frequency + phase) * 0.5 + 0.5 + noise;
            
            // Taper edges
            const edgeEffect = Math.sin((i / numBars) * Math.PI);
            
            barHeight = Math.max(2, amplitude * edgeEffect * height * 0.8);
          }
        }

        const y = (height - barHeight) / 2;

        // Gradient for bars
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, '#00d4ff'); // accent
        gradient.addColorStop(1, '#0055ff');

        ctx.fillStyle = isActive ? gradient : '#374151'; // gray-700 when inactive
        
        // Add glow effect if active
        if (isActive) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = '#00d4ff';
        } else {
          ctx.shadowBlur = 0;
        }

        // Draw rounded rectangle
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, barWidth/2);
        ctx.fill();
      }

      if (isActive) {
        phase += 0.1;
        animationId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [isActive, audioData]);

  return (
    <div className="w-full h-full flex items-center justify-center">
      <canvas 
        ref={canvasRef} 
        className="w-full h-full"
        width={800} // Logical width for high DPI rendering
        height={100}
      />
    </div>
  );
}
