// Logo AgroAves 2.0 — marca nova (símbolo + nome). Também exportada em public/logo.svg.
type Props = { size?: number; variant?: 'full' | 'mark' | 'light'; className?: string }

export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="AgroAves">
      <defs>
        <linearGradient id="agv-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#249a4a" />
          <stop offset="1" stopColor="#136130" />
        </linearGradient>
        <linearGradient id="agv-chick" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffdd85" />
          <stop offset="1" stopColor="#f5a600" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#agv-bg)" />
      {/* folha */}
      <path d="M46 14c-8 0-14 5-15 12 7 1 13-3 15-12z" fill="#a9e4b6" opacity="0.9" />
      {/* corpo do pintinho */}
      <circle cx="30" cy="40" r="13" fill="url(#agv-chick)" />
      {/* cabeça */}
      <circle cx="39" cy="27" r="8.5" fill="url(#agv-chick)" />
      {/* asa */}
      <path d="M20 41c3-4 9-5 13-2-3 3-8 5-13 2z" fill="#d98b00" opacity="0.8" />
      {/* bico */}
      <path d="M47 27l6 2.2-6 2.2z" fill="#ff7a1a" />
      {/* olho */}
      <circle cx="41" cy="25.5" r="1.6" fill="#1b2a1e" />
      {/* patas */}
      <path d="M26 52v4m0 0l-2.5 2.5M26 56l2.5 2.5M34 52v4m0 0l-2.5 2.5M34 56l2.5 2.5" stroke="#ff7a1a" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export default function Logo({ size = 40, variant = 'full', className = '' }: Props) {
  if (variant === 'mark') return <LogoMark size={size} />
  const light = variant === 'light'
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <LogoMark size={size} />
      <div className="leading-none">
        <div className={`font-extrabold tracking-tight ${light ? 'text-white' : 'text-leaf-800'}`} style={{ fontSize: size * 0.52 }}>
          Agro<span className={light ? 'text-brand-300' : 'text-brand-500'}>Aves</span>
        </div>
        <div className={`uppercase tracking-[0.22em] ${light ? 'text-leaf-100' : 'text-slate-500'}`} style={{ fontSize: size * 0.22, marginTop: size * 0.08 }}>
          Distribuidora
        </div>
      </div>
    </div>
  )
}
