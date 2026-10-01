// Abre uma janela só com o documento (sem menu nem filtros), com os estilos da aplicação,
// cores preservadas e tabela ajustada à largura da página. O usuário escolhe impressora ou "Salvar como PDF".
export function imprimirHtml(titulo: string, html: string, orientacao: 'landscape' | 'portrait' = 'landscape') {
  const w = window.open('', '_blank', 'width=1200,height=800')
  if (!w) { alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site.'); return }
  const estilos = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((n) => n.outerHTML).join('\n')
  w.document.open()
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title>${estilos}
<style>
  @page { size: A4 ${orientacao}; margin: 8mm; }
  html, body { background: #fff !important; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Inter, system-ui, sans-serif; color: #0f172a; }
  .card { border: 0 !important; box-shadow: none !important; border-radius: 0 !important; padding: 0 !important; overflow: visible !important; }
  table { width: 100% !important; table-layout: auto; border-collapse: collapse; page-break-inside: auto; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { page-break-inside: avoid; }
  th, td { font-size: 7.5pt !important; padding: 1px 3px !important; line-height: 1.15; }
  th.p-0 { padding: 0 0 2px 0 !important; }
  th.p-0 .text-base { font-size: 12pt !important; }
  th.p-0 .text-\\[11px\\] { font-size: 8pt !important; }
  th.p-0 img { height: 28px !important; width: auto !important; }
  .recibo-logo img { height: 40px !important; width: auto !important; }
  .grid.grid-cols-2 > div { min-height: 80mm; }
  th { white-space: normal !important; }
  td.whitespace-nowrap { white-space: normal !important; }
  .col-larga { min-width: 19mm !important; width: 19mm; }
  td.col-pagto { white-space: nowrap !important; }
  .no-print { display: none !important; }
  .print-page { page-break-after: always; }
  .barra-impressao { position: fixed; top: 8px; right: 8px; display: flex; gap: 6px; }
  .barra-impressao button { font: 600 12px Inter, sans-serif; padding: 6px 12px; border-radius: 6px; border: 1px solid #94a3b8; background: #fff; cursor: pointer; }
  .barra-impressao .ok { background: #0a1f4f; color: #fff; border-color: #0a1f4f; }
  @media print { .barra-impressao { display: none; } }
</style></head><body>
<div class="barra-impressao no-print"><button onclick="window.close()">Fechar</button><button class="ok" onclick="window.print()">Imprimir / salvar PDF</button></div>
${html}
<script>setTimeout(function(){ window.focus(); window.print() }, 400)</script>
</body></html>`)
  w.document.close()
}
