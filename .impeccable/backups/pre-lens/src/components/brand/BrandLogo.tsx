import React from 'react';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  withText?: boolean;
  className?: string;
  isArabic?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  withText = true,
  className = '',
  isArabic = true,
}) => {
  const sizeMap = {
    sm: { box: 'w-7 h-7', icon: 'w-4 h-4', text: 'text-sm', sub: 'text-[9px]' },
    md: { box: 'w-9 h-9', icon: 'w-5 h-5', text: 'text-base', sub: 'text-[10px]' },
    lg: { box: 'w-12 h-12', icon: 'w-6 h-6', text: 'text-xl', sub: 'text-xs' },
    xl: { box: 'w-16 h-16', icon: 'w-8 h-8', text: 'text-2xl', sub: 'text-xs' },
  };

  const s = sizeMap[size];

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* Nexus Emblem Icon */}
      <div className={`relative ${s.box} rounded-2xl bg-gradient-to-tr from-[#0d9488]/30 via-[#06b6d4]/20 to-[#38bdf8]/30 border border-[#2dd4bf]/40 flex items-center justify-center shadow-lg shadow-[#0d9488]/15 group hover:border-[#2dd4bf] transition duration-300`}>
        {/* Glow halo */}
        <div className="absolute inset-0 rounded-2xl bg-[#2dd4bf]/10 blur-sm pointer-events-none group-hover:bg-[#2dd4bf]/20 transition" />
        
        {/* Geometric Compass Nexus SVG */}
        <svg 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          className={`${s.icon} text-[#2dd4bf] stroke-[1.8] relative z-10 transition group-hover:scale-105`}
        >
          {/* Outer diamond */}
          <polygon points="12 2 22 12 12 22 2 12" stroke="currentColor" strokeOpacity="0.8" />
          {/* Inner square rotated 45 deg */}
          <rect x="6" y="6" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" strokeOpacity="0.9" />
          {/* Center core */}
          <circle cx="12" cy="12" r="2.5" fill="currentColor" />
          {/* Compass ticks */}
          <line x1="12" y1="2" x2="12" y2="5" stroke="currentColor" strokeLinecap="round" />
          <line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" strokeLinecap="round" />
          <line x1="2" y1="12" x2="5" y2="12" stroke="currentColor" strokeLinecap="round" />
          <line x1="19" y1="12" x2="22" y2="12" stroke="currentColor" strokeLinecap="round" />
        </svg>
      </div>

      {withText && (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className={`font-bold tracking-tight text-white ${s.text} font-sans`}>
              {isArabic ? 'كـاشِـف' : 'KASHIF'}
            </span>
            <span className="px-1.5 py-0.2 rounded-md bg-[#2dd4bf]/10 border border-[#2dd4bf]/30 text-[#2dd4bf] font-mono text-[9px] font-semibold tracking-wider uppercase">
              Pro
            </span>
          </div>
          <span className={`text-slate-400 font-medium ${s.sub} tracking-wide`}>
            {isArabic ? 'منظومة الاستكشاف المعرفي العميق' : 'Autonomous Deep Research'}
          </span>
        </div>
      )}
    </div>
  );
};
