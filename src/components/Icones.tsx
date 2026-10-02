/** Cifrão com seta: entrada (verde, seta descendo = dinheiro chegando) ou saída (vermelho, seta subindo = dinheiro saindo) */
export function IconeDinheiro({ sentido }: { sentido: 'entrada' | 'saida' }) {
  const cor = sentido === 'entrada' ? '#16a34a' : '#dc2626'
  return (
    <svg viewBox="0 0 24 24" width="1.15em" height="1.15em" className="inline-block shrink-0 align-middle" aria-hidden="true">
      <text x="8" y="19" textAnchor="middle" fontSize="20" fontWeight="900" fontFamily="system-ui, sans-serif" fill={cor}>$</text>
      <g stroke={cor} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {sentido === 'entrada'
          ? <><path d="M18.5 3v14" /><path d="M14.5 13 18.5 17l4-4" /></>
          : <><path d="M18.5 21V7" /><path d="M14.5 11 18.5 7l4 4" /></>}
      </g>
    </svg>
  )
}
