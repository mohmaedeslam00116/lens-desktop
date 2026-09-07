import React from 'react';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  withText?: boolean;
  className?: string;
  isArabic?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 'md', withText = true, className = '' }) => (
  <span className={`brand-logo brand-logo--${size} ${className}`} dir="ltr" aria-label="LENS">
    <svg className="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 2v5M30 16h-5M16 30v-5M2 16h5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
    {withText && <span className="brand-wordmark">LENS</span>}
  </span>
);
