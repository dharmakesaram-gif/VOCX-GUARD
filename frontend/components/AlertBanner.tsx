'use client';

import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface AlertBannerProps {
  message: string;
  isVisible: boolean;
  onDismiss: () => void;
}

export default function AlertBanner({ message, isVisible, onDismiss }: AlertBannerProps) {
  if (!isVisible) return null;

  return (
    <div className="w-full bg-danger text-white overflow-hidden transition-all duration-500 animate-slide-down">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="animate-pulse" size={20} />
          <p className="font-medium text-sm md:text-base">{message}</p>
        </div>
        <button 
          onClick={onDismiss}
          className="p-1 hover:bg-black/20 rounded-full transition-colors"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  );
}
