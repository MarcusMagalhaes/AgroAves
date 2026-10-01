// Logomarca oficial AgroAves Distribuidora (public/logo.png) e símbolo (public/marca.png)
type Props = { size?: number; variant?: 'full' | 'mark' | 'light'; className?: string }

const base = import.meta.env.BASE_URL

export function LogoMark({ size = 40 }: { size?: number }) {
  return <img src={`${base}marca.png`} width={size} height={size} alt="AgroAves" style={{ width: size, height: size }} draggable={false} />
}

export default function Logo({ size = 40, variant = 'full', className = '' }: Props) {
  if (variant === 'mark') return <LogoMark size={size} />
  // logo completa tem proporção ≈ 2.2:1
  const h = size * 1.3
  return (
    <img src={`${base}logo.png`} alt="AgroAves Distribuidora" className={className} draggable={false}
      style={{ height: h, width: 'auto', filter: variant === 'light' ? 'drop-shadow(0 0 1px rgba(255,255,255,.9))' : undefined }} />
  )
}
