'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Shield, Radio, Users, FileAudio, Cpu, Wifi } from 'lucide-react';

export default function Navbar() {
  const pathname = usePathname();

  const navLinks = [
    { href: '/', label: 'Live Monitor', icon: Radio, badge: 'REAL-TIME' },
    { href: '/enroll', label: 'Voice Enrollment', icon: Users, badge: 'BIOMETRIC' },
    { href: '/analysis', label: 'Forensic Lab', icon: FileAudio, badge: 'TRI-NET AI' },
  ];

  return (
    <nav className="glassmorphism sticky top-0 z-50 w-full px-4 lg:px-8 py-3.5 border-b border-cyan-500/20 mb-6">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500/20 via-blue-600/30 to-purple-600/20 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_15px_rgba(0,240,255,0.3)] group-hover:shadow-[0_0_25px_rgba(0,240,255,0.6)] transition-all">
              <Shield size={22} className="text-cyan-400 group-hover:scale-110 transition-transform" />
            </div>
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-black text-xl tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-100 to-cyan-400">
                VOCX<span className="text-cyan-400">GUARD</span>
              </span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/30">
                v2.6
              </span>
            </div>
            <span className="text-[11px] font-mono tracking-tight text-gray-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
              AI Voice Clone Defense Intelligence
            </span>
          </div>
        </Link>

        {/* Navigation links */}
        <div className="flex items-center gap-2 md:gap-3">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-gradient-to-r from-cyan-950/80 to-blue-950/80 text-cyan-300 border border-cyan-400/50 shadow-[0_0_15px_rgba(0,240,255,0.25)]'
                    : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-cyan-400 animate-pulse' : 'text-gray-400'} />
                <span>{link.label}</span>
                {link.badge && (
                  <span
                    className={`hidden xl:inline text-[9px] font-mono px-1.5 py-0.2 rounded ${
                      isActive
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40'
                        : 'bg-white/5 text-gray-500 border border-white/10'
                    }`}
                  >
                    {link.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* System Health Status */}
        <div className="hidden lg:flex items-center gap-3 pl-4 border-l border-white/10 font-mono text-xs">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-400">
            <Wifi size={13} className="animate-pulse" />
            <span className="font-semibold text-[11px]">3-NET ACTIVE</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
