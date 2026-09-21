'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Shield, Radio, Users, FileAudio } from 'lucide-react';

export default function Navbar() {
  const pathname = usePathname();

  const navLinks = [
    { href: '/', label: 'Live Monitor', icon: Radio },
    { href: '/enroll', label: 'Enrollment', icon: Users },
    { href: '/analysis', label: 'Forensic Analysis', icon: FileAudio },
  ];

  return (
    <nav className="glassmorphism sticky top-0 z-50 w-full px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-2 text-accent font-bold text-xl tracking-wider">
        <Shield size={28} className="text-accent glow-effect rounded-full" />
        VOCX GUARD
      </div>
      <div className="flex gap-6">
        {navLinks.map((link) => {
          const isActive = pathname === link.href;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-md transition-all duration-300 ${
                isActive
                  ? 'bg-primary text-accent border border-accent glow-effect'
                  : 'text-gray-400 hover:text-white hover:bg-primary'
              }`}
            >
              <Icon size={18} />
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
