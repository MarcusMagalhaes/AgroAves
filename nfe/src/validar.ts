// Validação do XML contra os schemas oficiais (xmllint). Pega a maior parte das rejeições antes de chegar à SEFAZ.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCHEMA_NFE = fileURLToPath(new URL('../schemas/nfe_v4.00.xsd', import.meta.url))

export function validarSchema(xml: string): { ok: boolean; erros: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'nfe-'))
  const arq = join(dir, 'nfe.xml')
  try {
    writeFileSync(arq, xml)
    execFileSync('xmllint', ['--noout', '--schema', SCHEMA_NFE, arq], { stdio: 'pipe' })
    return { ok: true, erros: [] }
  } catch (e: any) {
    if (e.code === 'ENOENT') return { ok: true, erros: ['xmllint não instalado: validação de schema pulada'] }
    const saida = String(e.stderr ?? e.message)
    return { ok: false, erros: saida.split('\n').filter((l) => l.trim() && !l.includes('fails to validate')) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
