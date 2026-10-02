"""
Migração das planilhas AgroAves (Admin.xlsx + VENDAS.xlsx) para o banco Supabase/PostgreSQL.
Base: docs/10-migracao-de-dados.md.

Uso:
  pip install openpyxl psycopg2-binary
  python migracao/migrar.py --admin ../Admin.xlsx --vendas "../VENDAS - Agro Aves Distribuidora.xlsx" --dsn "postgresql://postgres:SENHA@db.xxxx.supabase.co:5432/postgres"

Sem --dsn, gera apenas os CSVs limpos em migracao/saida/ e o relatório de rejeições (carga de ensaio).
A carga é idempotente nas tabelas de cadastro (upsert por código/sigla/nome) e APAGA e recarrega
pedidos/contatos/títulos/pedidos à granja importados do legado (marcados com observacao LIKE 'LEGADO%').
"""
import argparse, csv, collections, datetime, io, os, re, sys, unicodedata

import openpyxl

sys.stdout.reconfigure(encoding="utf-8")

PROD = "COR, PP, CJ, P.S, MS, PJ, GC, NGR, PV, PN, CRE, PB, AZU, VER, CIN, PC, CDN, ANG1, ANG2, IND1, IND2, MAR1, MAR2, BRH1, BRH2, VIVC, VIVS".split(", ")
ROTAS_ABAS = ["MONTES CLAROS", "VARGEM ALEGRE", "CAPELINHA", "PIRAPORA", "VIÇOSA", "CARATINGA", "RIO ESPERA", "IPANEMA", "BOM JESUS DO GALHO"]
INTERVALO_DIAS = 14

rejeicoes: list[tuple[str, str, str]] = []  # (tabela, linha_origem, motivo)


def rej(tabela, origem, motivo):
    rejeicoes.append((tabela, str(origem), motivo))


# ---------- transformações ----------
def f_data(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime.datetime):
        return v.date()
    if isinstance(v, datetime.date):
        return v
    s = str(v).strip()
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(s[:10], fmt).date()
        except ValueError:
            pass
    return None


def f_forma(v):
    s = unicodedata.normalize("NFD", str(v or "")).encode("ascii", "ignore").decode().lower().replace(" ", "")
    if s.startswith("bol"):
        return "BOLETO"
    if s.startswith("ant"):
        return "ANTECIPADO"
    if s.startswith("avista") or s == "vista":
        return "A_VISTA"
    return None


def f_resultado(v):
    s = (v or "").strip().lower()
    if s.startswith("realizou pedido"):
        return "PEDIDO"
    if "não teve interesse" in s or "nao teve interesse" in s:
        return "SEM_INTERESSE"
    if s.startswith("sem sucesso"):
        return "SEM_CONTATO"
    if s.startswith("demonstrou interesse"):
        return "INTERESSE_SEM_PEDIDO"
    return None


def f_num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 2)
    s = str(v).strip().replace("R$", "").replace(".", "").replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def f_int(v):
    if v is None or v == "":
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip()
    return int(float(s)) if re.fullmatch(r"-?\d+(\.\d+)?", s) else 0


def f_doc(v):
    s = re.sub(r"\D", "", str(v or ""))
    return s or None


def f_trim(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v not in (None, "") else None


def sim(v):
    return str(v or "").strip().lower() == "sim"


# ---------- leitura ----------
def rows(wb, nome, min_row, max_col=None):
    ws = wb[nome]
    return list(ws.iter_rows(min_row=min_row, max_col=max_col, values_only=True))


def extrair(admin_path, vendas_path):
    print("Lendo", admin_path)
    adm = openpyxl.load_workbook(admin_path, read_only=True, data_only=True)
    print("Lendo", vendas_path)
    ven = openpyxl.load_workbook(vendas_path, read_only=True, data_only=True)
    d = {}

    # Rotas
    d["rotas"] = []
    for r in rows(adm, "Rotas", 2, 7):
        if not r[0]:
            continue
        d["rotas"].append(dict(nome=f_trim(r[0]).upper(), vendedor=f_trim(r[1]), telefone=f_trim(r[2]), cidade=f_trim(r[4]).upper(),
                               semana_atual=f_data(r[5]), proxima=f_data(r[6])))

    # Clientes
    hdr = list(rows(adm, "Clientes", 3, 44)[0])
    idx_prod = {hdr[i]: i for i in range(17, 44)}
    d["clientes"] = []
    d["precos"] = []
    d["rota_cliente"] = []
    for n, r in enumerate(rows(adm, "Clientes", 5, 44), start=5):
        if r[1] in (None, ""):
            continue
        codigo = f_int(r[1])
        razao = f_trim(r[4])
        tipo = "REPOSICAO" if razao and "REPOSI" in razao.upper() else "CLIENTE"
        if not razao:
            rej("cliente", n, f"código {codigo} sem razão social (D-11) — não migrado")
            continue
        forma = f_forma(r[12]) or "BOLETO"
        if f_forma(r[12]) is None:
            rej("cliente", n, f"código {codigo} sem forma de pagamento; assumido BOLETO")
        d["clientes"].append(dict(codigo=codigo, codigo_externo=f_trim(r[2]), cnpj_cpf=f_doc(r[3]), razao_social=razao, nome_fantasia=f_trim(r[5]),
                                  endereco=f_trim(r[6]), cidade=f_trim(r[7]), contato=f_trim(r[8]), telefone=f_trim(r[9]), local_entrega=f_trim(r[10]),
                                  exige_nf=sim(r[11]), exige_gta=sim(r[13]), forma_pagamento=forma, tipo=tipo, ativo=(tipo == "CLIENTE")))
        rotas = {f_trim(r[14]), f_trim(r[15])} - {None, ""}
        for rt in rotas:
            d["rota_cliente"].append(dict(rota=rt.upper(), codigo=codigo))
        for sigla, i in idx_prod.items():
            v = r[i]
            if isinstance(v, (int, float)):
                d["precos"].append(dict(codigo=codigo, sigla=sigla, preco=round(float(v), 2)))
            elif v not in (None, ""):
                rej("preco_cliente", n, f"código {codigo} {sigla}: preço não numérico {v!r}")

    # Produtos
    d["produtos"] = []
    for i, r in enumerate(rows(adm, "Cad Produtos", 2, 4), start=1):
        if not r[0]:
            continue
        sigla = f_trim(r[0])
        grupo = {"EXÓTICOS": "EXOTICOS", "ACESSÓRIOS": "ACESSORIOS"}.get(f_trim(r[2]) or "", f_trim(r[2]))
        if sigla == "R":
            continue  # reposição vira campo do pedido
        d["produtos"].append(dict(sigla=sigla, nome=f_trim(r[1]), grupo=grupo, ordem=i, preco_compra=f_num(r[3]), tem_preco=True,
                                  conta_como_ave=grupo != "ACESSORIOS", eh_codorna=sigla == "CDN"))

    # Ordem de visita (abas de rota da Vendas)
    d["ordem"] = []
    for rota in ROTAS_ABAS:
        if rota not in ven.sheetnames:
            rej("rota_cliente", rota, "aba de rota ausente na Vendas")
            continue
        pos = 0
        for n, r in enumerate(rows(ven, rota, 5, 3), start=5):
            if r[2] in (None, ""):
                continue
            if isinstance(r[1], (int, float)):
                pos += 1
                d["ordem"].append(dict(rota=rota, codigo=int(r[1]), ordem=pos))
            else:
                rej("rota_cliente", f"{rota}!{n}", f"cliente '{r[2]}' sem COD válido ({r[1]!r}) — nome duplicado ou #REF!")

    # Fechamento Geral (histórico)
    hdr = list(rows(adm, "Fechamento Geral", 3, 40)[0])
    col = {h: i for i, h in enumerate(hdr) if h}
    d["pedidos"] = []
    for n, r in enumerate(rows(adm, "Fechamento Geral", 4, 40), start=4):
        if r[2] in (None, ""):
            continue
        data = f_data(r[1])
        if not data:
            rej("pedido", n, f"DATA inválida {r[1]!r}")
            continue
        qtd = {}
        for s in PROD:
            v = r[col[s]]
            q = f_int(v)
            if q > 0:
                qtd[s] = q
            elif v not in (None, "", 0) and not isinstance(v, (int, float)):
                rej("pedido_item", n, f"{s} não numérico {v!r} tratado como vazio")
        d["pedidos"].append(dict(linha=n, rota=f_trim(r[0]).upper(), data=data, codigo=f_int(r[2]), cliente=f_trim(r[3]), nome=f_trim(r[4]),
                                 cidade=f_trim(r[5]), contato=f_trim(r[6]), fone=f_trim(r[7]), local=f_trim(r[8]), forma=f_forma(r[9]),
                                 qtd=qtd, reposicao=f_int(r[col["R"]]), total=f_num(r[col["TOTAL R$"]]) or 0.0, distribuicao=f_trim(r[39])))

    # Interesses (Admin + órfãs da Vendas)
    d["contatos"] = []
    for origem, wb in (("Admin", adm), ("Vendas", ven)):
        for n, r in enumerate(rows(wb, "Interesses Clientes", 2, 8), start=2):
            if r[1] in (None, ""):
                continue
            res = f_resultado(r[7])
            if not res:
                rej("contato_cliente", f"{origem}!{n}", f"resultado desconhecido {r[7]!r}")
                continue
            d["contatos"].append(dict(origem=origem, data=f_data(r[0]), codigo=f_int(r[1]), resultado=res))

    # Financeiro
    d["titulos"] = []
    for n, r in enumerate(rows(adm, "Financeiro", 2, 13), start=2):
        if r[1] in (None, ""):
            continue
        valor = f_num(r[7])
        if valor is None:
            rej("titulo", n, f"valor inválido {r[7]!r} (D-15) — descartado")
            continue
        sit = {"Pendente": "PENDENTE", "Baixado": "BAIXADO", "Cancelado": "CANCELADO"}.get(str(r[9]).strip())
        if not sit:
            rej("titulo", n, f"situação desconhecida {r[9]!r}")
            continue
        data_baixa = f_data(r[10])
        motivo = "LEGADO"
        if sit == "BAIXADO" and not data_baixa:
            data_baixa = f_data(r[11]) or f_data(r[0])
            motivo = "LEGADO_DATA_BAIXA_ESTIMADA"
        if valor < 0:
            motivo = "LEGADO_AJUSTE_NEGATIVO"
        d["titulos"].append(dict(data=f_data(r[0]), codigo=f_int(r[1]), valor=valor, forma=f_forma(r[8]) or "BOLETO", situacao=sit,
                                 data_baixa=data_baixa, criado_em=r[11] if isinstance(r[11], datetime.datetime) else None, email=f_trim(r[12]), motivo=motivo))

    # Pedidos Fornecedor
    hdr = list(rows(adm, "Pedidos Fornecedor", 1, 31)[0])
    col = {h: i for i, h in enumerate(hdr) if h}
    d["pf"] = []
    for n, r in enumerate(rows(adm, "Pedidos Fornecedor", 2, 31), start=2):
        if r[1] in (None, ""):
            continue
        d["pf"].append(dict(data=f_data(r[1]), cidade=f_trim(r[2]).upper(), registrado_em=r[30] if isinstance(r[30], datetime.datetime) else None,
                            qtd={s: f_int(r[col[s]]) for s in PROD if f_int(r[col[s]]) > 0}))

    # Semana em aberto (Vendas)
    hdr = list(rows(ven, "Programação Semanal", 3, 40)[0])
    col = {h: i for i, h in enumerate(hdr) if h}
    d["abertos"] = []
    for n, r in enumerate(rows(ven, "Programação Semanal", 4, 40), start=4):
        if r[2] in (None, ""):
            continue
        qtd = {s: f_int(r[col[s]]) for s in PROD if f_int(r[col[s]]) > 0}
        d["abertos"].append(dict(linha=n, rota=f_trim(r[0]).upper(), data=f_data(r[1]), codigo=f_int(r[2]), forma=f_forma(r[9]), qtd=qtd,
                                 reposicao=f_int(r[col["R"]]), total=f_num(r[col["TOTAL R$"]]) or 0.0))
    return d


# ---------- transformação para o modelo alvo ----------
def transformar(d):
    clientes = {c["codigo"]: c for c in d["clientes"]}
    rotas = {r["nome"]: r for r in d["rotas"]}
    cidades = sorted({r["cidade"] for r in d["rotas"]} | {p["cidade"] for p in d["pf"]})
    vendedores = {}
    for r in d["rotas"]:
        if r["vendedor"]:
            vendedores[r["vendedor"].upper()] = dict(nome=r["vendedor"].upper(), telefone=r["telefone"])

    # clientes só no histórico → inativos (D-12)
    for p in d["pedidos"]:
        if p["codigo"] not in clientes:
            clientes[p["codigo"]] = dict(codigo=p["codigo"], codigo_externo=None, cnpj_cpf=None, razao_social=p["cliente"] or f"CLIENTE {p['codigo']}",
                                        nome_fantasia=p["nome"], endereco=None, cidade=p["cidade"], contato=p["contato"], telefone=p["fone"],
                                        local_entrega=p["local"], exige_nf=False, exige_gta=False, forma_pagamento=p["forma"] or "BOLETO",
                                        tipo="REPOSICAO" if (p["cliente"] or "").upper().startswith(("REPOSI", "SOBRA")) else "CLIENTE",
                                        ativo=False, observacao="LEGADO: código só existia no histórico")
            rej("cliente", p["linha"], f"código {p['codigo']} '{p['cliente']}' não estava no cadastro — criado inativo (D-12)")

    # rota_cliente com ordem
    ordem = {(o["rota"], o["codigo"]): o["ordem"] for o in d["ordem"]}
    vinculos = {}
    for rc in d["rota_cliente"]:
        if rc["rota"] not in rotas:
            rej("rota_cliente", rc["codigo"], f"rota {rc['rota']} inexistente")
            continue
        if clientes.get(rc["codigo"], {}).get("tipo") == "REPOSICAO":
            continue
        vinculos[(rc["rota"], rc["codigo"])] = ordem.get((rc["rota"], rc["codigo"]))
    for (rota, cod), pos in ordem.items():
        if (rota, cod) not in vinculos and cod in clientes and clientes[cod]["tipo"] == "CLIENTE":
            vinculos[(rota, cod)] = pos
            rej("rota_cliente", f"{rota}/{cod}", "cliente na aba de rota mas sem a rota no cadastro — vínculo criado")
    rota_cliente = []
    for rota in rotas:
        itens = [(cod, pos) for (rt, cod), pos in vinculos.items() if rt == rota]
        com = sorted([x for x in itens if x[1]], key=lambda x: x[1])
        sem = sorted([x for x in itens if not x[1]], key=lambda x: clientes[x[0]]["razao_social"])
        for i, (cod, _) in enumerate(com + sem, start=1):
            rota_cliente.append(dict(rota=rota, codigo=cod, ordem_visita=i))
        for cod, _ in sem:
            rej("rota_cliente", f"{rota}/{cod}", "cliente sem posição na aba de rota — colocado no fim (ordenar manualmente)")

    # semanas fechadas por rota/data
    semanas = {}
    for p in d["pedidos"]:
        if p["rota"] not in rotas:
            rej("pedido", p["linha"], f"rota {p['rota']} inexistente")
            continue
        semanas.setdefault((p["rota"], p["data"]), "FECHADA")
    for r in d["rotas"]:
        if r["semana_atual"]:
            semanas[(r["nome"], r["semana_atual"])] = "ABERTA"

    # pedidos fechados; agrupa duplicados (D-13: soma)
    pedidos = {}
    precos_atuais = {(p["codigo"], p["sigla"]): p["preco"] for p in d["precos"]}
    for p in d["pedidos"]:
        if p["rota"] not in rotas:
            continue
        cli = clientes[p["codigo"]]
        tipo = "CLIENTE"
        if cli["tipo"] == "REPOSICAO" or (p["cliente"] or "").upper().startswith("SOBRA"):
            tipo = "SOBRA" if (p["cliente"] or "").upper().startswith("SOBRA") else "REPOSICAO"
        key = (p["rota"], p["data"], p["codigo"] if tipo == "CLIENTE" else f"{tipo}:{p['codigo']}")
        if key in pedidos:
            rej("pedido", p["linha"], f"duplicado rota/cliente/semana — quantidades somadas (D-13)")
            for s, q in p["qtd"].items():
                pedidos[key]["qtd"][s] = pedidos[key]["qtd"].get(s, 0) + q
            pedidos[key]["reposicao"] += p["reposicao"]
            pedidos[key]["total"] += p["total"] if tipo == "CLIENTE" else 0
            continue
        if not p["qtd"] and not p["reposicao"]:
            rej("pedido", p["linha"], "pedido sem quantidades (D-14) — migrado marcado LEGADO_ZERADO")
        forma = p["forma"] or cli["forma_pagamento"]
        if not p["forma"]:
            rej("pedido", p["linha"], f"sem forma de pagamento — usada a do cadastro ({forma})")
        obs = ["LEGADO"]
        if not p["qtd"] and not p["reposicao"]:
            obs.append("ZERADO")
        if tipo != "CLIENTE":
            obs.append(f"pseudo-cliente {p['codigo']} '{p['cliente']}' total original {p['total']}")
        pedidos[key] = dict(rota=p["rota"], data=p["data"], codigo=p["codigo"] if tipo == "CLIENTE" else None, tipo=tipo, forma=forma if tipo == "CLIENTE" else None,
                            distribuicao=p["distribuicao"] or rotas[p["rota"]]["cidade"], qtd=p["qtd"], reposicao=p["reposicao"],
                            total=p["total"] if tipo == "CLIENTE" else 0.0, status="FECHADO", observacao=" ".join(obs),
                            itens={s: (q, precos_atuais.get((p["codigo"], s), 0.0)) for s, q in p["qtd"].items()})

    # pedidos abertos (semana em aberto da Vendas)
    for p in d["abertos"]:
        if p["rota"] not in rotas or p["codigo"] not in clientes:
            rej("pedido", f"Vendas!{p['linha']}", "rota/cliente inexistente")
            continue
        semanas.setdefault((p["rota"], p["data"]), "ABERTA")
        key = (p["rota"], p["data"], p["codigo"])
        cli = clientes[p["codigo"]]
        pedidos[key] = dict(rota=p["rota"], data=p["data"], codigo=p["codigo"], tipo="CLIENTE", forma=p["forma"] or cli["forma_pagamento"],
                            distribuicao=rotas[p["rota"]]["cidade"], qtd=p["qtd"], reposicao=p["reposicao"], total=p["total"], status="ABERTO",
                            observacao="LEGADO semana em aberto", itens={s: (q, precos_atuais.get((p["codigo"], s), 0.0)) for s, q in p["qtd"].items()})

    # contatos: rota inferida pelo pedido do mesmo cliente/data, senão rota principal
    rota_principal = {}
    for rc in sorted(rota_cliente, key=lambda x: x["ordem_visita"]):
        rota_principal.setdefault(rc["codigo"], rc["rota"])
    pedidos_por_cli_data = {}
    for (rota, data, cod), p in pedidos.items():
        if isinstance(cod, int):
            pedidos_por_cli_data.setdefault((cod, data), rota)
    contatos = {}
    for c in d["contatos"]:
        if c["codigo"] not in clientes or not c["data"]:
            rej("contato_cliente", f"{c['origem']} {c['codigo']}", "cliente inexistente ou data inválida")
            continue
        rota = pedidos_por_cli_data.get((c["codigo"], c["data"])) or rota_principal.get(c["codigo"])
        if not rota:
            rej("contato_cliente", f"{c['origem']} {c['codigo']} {c['data']}", "não foi possível inferir a rota")
            continue
        semanas.setdefault((rota, c["data"]), "FECHADA")
        contatos[(rota, c["data"], c["codigo"])] = dict(rota=rota, data=c["data"], codigo=c["codigo"], resultado=c["resultado"])

    # títulos: vínculo ao pedido
    titulos = []
    for t in d["titulos"]:
        if t["codigo"] not in clientes:
            rej("titulo", t["codigo"], "cliente inexistente")
            continue
        rota = pedidos_por_cli_data.get((t["codigo"], t["data"]))
        titulos.append(dict(**t, rota=rota))

    # pedidos fornecedor: programado recalculado
    pf = []
    for x in d["pf"]:
        prog = collections.Counter()
        for p in pedidos.values():
            if p["data"] == x["data"] and p["distribuicao"] == x["cidade"]:
                prog.update(p["qtd"])
        pf.append(dict(**x, programado=dict(prog)))

    return dict(cidades=cidades, vendedores=list(vendedores.values()), rotas=list(rotas.values()), clientes=list(clientes.values()),
                precos=d["precos"], produtos=d["produtos"], rota_cliente=rota_cliente, semanas=semanas, pedidos=list(pedidos.values()),
                contatos=list(contatos.values()), titulos=titulos, pf=pf)


# ---------- saída CSV ----------
def gravar_csv(m, pasta):
    os.makedirs(pasta, exist_ok=True)

    def w(nome, linhas, campos):
        with io.open(os.path.join(pasta, nome + ".csv"), "w", encoding="utf-8", newline="") as f:
            wr = csv.DictWriter(f, fieldnames=campos, delimiter=";", extrasaction="ignore")
            wr.writeheader()
            for l in linhas:
                wr.writerow(l)

    w("cliente", m["clientes"], ["codigo", "codigo_externo", "cnpj_cpf", "razao_social", "nome_fantasia", "endereco", "cidade", "contato", "telefone", "local_entrega", "exige_nf", "exige_gta", "forma_pagamento", "tipo", "ativo", "observacao"])
    w("preco_cliente", m["precos"], ["codigo", "sigla", "preco"])
    w("rota_cliente", m["rota_cliente"], ["rota", "codigo", "ordem_visita"])
    w("rota", m["rotas"], ["nome", "vendedor", "telefone", "cidade", "semana_atual", "proxima"])
    w("produto", m["produtos"], ["sigla", "nome", "grupo", "ordem", "preco_compra", "conta_como_ave", "eh_codorna"])
    ped = []
    for p in m["pedidos"]:
        ped.append(dict(rota=p["rota"], data=p["data"], codigo=p["codigo"], tipo=p["tipo"], forma=p["forma"], distribuicao=p["distribuicao"], reposicao=p["reposicao"], total=p["total"], status=p["status"], observacao=p["observacao"], **{s: q for s, (q, _) in p["itens"].items()}))
    w("pedido", ped, ["rota", "data", "codigo", "tipo", "forma", "distribuicao", *PROD, "reposicao", "total", "status", "observacao"])
    w("contato_cliente", m["contatos"], ["rota", "data", "codigo", "resultado"])
    w("titulo", m["titulos"], ["data", "codigo", "valor", "forma", "situacao", "data_baixa", "criado_em", "email", "motivo", "rota"])
    w("pedido_fornecedor", [dict(data=x["data"], cidade=x["cidade"], registrado_em=x["registrado_em"], **x["qtd"]) for x in m["pf"]], ["data", "cidade", "registrado_em", *PROD])
    with io.open(os.path.join(pasta, "rejeicoes.csv"), "w", encoding="utf-8", newline="") as f:
        wr = csv.writer(f, delimiter=";")
        wr.writerow(["tabela", "origem", "motivo"])
        wr.writerows(rejeicoes)
    print(f"CSVs em {pasta} — {len(rejeicoes)} rejeições/avisos (rejeicoes.csv)")


# ---------- carga no banco (em lote: tabelas temporárias + insert ... select) ----------
def carregar(m, dsn):
    import psycopg2
    from psycopg2.extras import execute_values

    cn = psycopg2.connect(dsn)
    cn.autocommit = False
    cur = cn.cursor()
    ev = lambda sql, rows: execute_values(cur, sql, rows, page_size=2000) if rows else None
    try:
        print("1/8 cadastros básicos")
        ev("insert into cidade_distribuicao (nome) values %s on conflict (nome) do nothing", [(c,) for c in m["cidades"]])
        cur.execute("insert into fornecedor (nome) values ('Granja') on conflict (nome) do nothing")
        ev("insert into vendedor (nome, telefone) select v.nome, v.tel from (values %s) v(nome, tel) where not exists (select 1 from vendedor x where x.nome = v.nome)",
           [(v["nome"], v["telefone"]) for v in m["vendedores"]])
        ev("""insert into produto (sigla, nome, grupo, ordem, preco_compra, tem_preco, conta_como_ave, eh_codorna) values %s
              on conflict (sigla) do update set nome=excluded.nome, grupo=excluded.grupo, ordem=excluded.ordem, preco_compra=excluded.preco_compra,
              conta_como_ave=excluded.conta_como_ave, eh_codorna=excluded.eh_codorna""",
           [(p["sigla"], p["nome"], p["grupo"], p["ordem"], p["preco_compra"], True, p["conta_como_ave"], p["eh_codorna"]) for p in m["produtos"]])
        ev("""insert into rota (nome, vendedor_id, cidade_distribuicao_id, intervalo_dias)
              select v.nome, (select id from vendedor where nome = v.vend), (select id from cidade_distribuicao where nome = v.cid), v.dias from (values %s) v(nome, vend, cid, dias)
              on conflict (nome) do update set vendedor_id=excluded.vendedor_id, cidade_distribuicao_id=excluded.cidade_distribuicao_id""",
           [(r["nome"], (r["vendedor"] or "").upper(), r["cidade"], INTERVALO_DIAS) for r in m["rotas"]])

        print("2/8 clientes, preços, rotas × clientes")
        ev("""insert into cliente (codigo, codigo_externo, cnpj_cpf, razao_social, nome_fantasia, endereco, cidade, contato, telefone, local_entrega, exige_nf, exige_gta, forma_pagamento, tipo, ativo, observacao) values %s
              on conflict (codigo) do update set codigo_externo=excluded.codigo_externo, cnpj_cpf=excluded.cnpj_cpf, razao_social=excluded.razao_social, nome_fantasia=excluded.nome_fantasia,
              endereco=excluded.endereco, cidade=excluded.cidade, contato=excluded.contato, telefone=excluded.telefone, local_entrega=excluded.local_entrega,
              exige_nf=excluded.exige_nf, exige_gta=excluded.exige_gta, forma_pagamento=excluded.forma_pagamento, tipo=excluded.tipo, ativo=excluded.ativo""",
           [(c["codigo"], c["codigo_externo"], c["cnpj_cpf"], c["razao_social"], c["nome_fantasia"], c["endereco"], c["cidade"], c["contato"], c["telefone"], c["local_entrega"],
             c["exige_nf"], c["exige_gta"], c["forma_pagamento"], c["tipo"], c["ativo"], c.get("observacao")) for c in m["clientes"]])
        cur.execute("delete from preco_cliente")
        ev("""insert into preco_cliente (cliente_id, produto_id, preco)
              select c.id, p.id, v.preco from (values %s) v(codigo, sigla, preco) join cliente c on c.codigo=v.codigo join produto p on p.sigla=v.sigla on conflict do nothing""",
           [(p["codigo"], p["sigla"], p["preco"]) for p in m["precos"]])
        cur.execute("delete from rota_cliente")
        ev("""insert into rota_cliente (rota_id, cliente_id, ordem_visita)
              select r.id, c.id, v.ordem from (values %s) v(rota, codigo, ordem) join rota r on r.nome=v.rota join cliente c on c.codigo=v.codigo""",
           [(x["rota"], x["codigo"], x["ordem_visita"]) for x in m["rota_cliente"]])

        print("3/8 limpando carga legada anterior")
        cur.execute("delete from titulo where motivo like 'LEGADO%'")
        # títulos gerados no sistema para pedidos legados: desvincula (preserva o título)
        cur.execute("update titulo set pedido_id = null where pedido_id in (select id from pedido where observacao like 'LEGADO%')")
        cur.execute("delete from pedido where observacao like 'LEGADO%'")
        cur.execute("delete from contato_cliente where registrado_por is null")
        cur.execute("delete from pedido_fornecedor where observacao = 'LEGADO'")

        print("4/8 semanas")
        abertas = [(rota, data) for (rota, data), st in m["semanas"].items() if st == "ABERTA"]
        ev("""update semana_rota s set status='FECHADA', fechada_em=now() from (values %s) v(rota, data), rota r
              where r.nome=v.rota and s.rota_id=r.id and s.status='ABERTA' and s.data_entrega<>v.data""", [(r, d) for r, d in abertas])
        ev("""insert into semana_rota (rota_id, data_entrega, status, fechada_em)
              select r.id, v.data, v.st, case when v.st='FECHADA' then now() end from (values %s) v(rota, data, st) join rota r on r.nome=v.rota
              on conflict (rota_id, data_entrega) do update set status=excluded.status""",
           [(rota, data, st) for (rota, data), st in m["semanas"].items()])

        print("5/8 pedidos e itens")
        cur.execute("""create temp table tmp_pedido (k int primary key, rota text, data date, codigo int, tipo text, forma text, distribuicao text,
                       reposicao int, total numeric, status text, observacao text, criado_em timestamptz) on commit drop""")
        cur.execute("create temp table tmp_item (k int, sigla text, q int, pr numeric) on commit drop")
        ped = m["pedidos"]
        ev("insert into tmp_pedido values %s",
           [(k, p["rota"], p["data"], p["codigo"], p["tipo"], p["forma"], p["distribuicao"], p["reposicao"], p["total"], p["status"],
             "LEGADO#%d %s" % (k, p["observacao"]), datetime.datetime.combine(p["data"], datetime.time(12))) for k, p in enumerate(ped)])
        ev("insert into tmp_item values %s", [(k, s_, q, pr) for k, p in enumerate(ped) for s_, (q, pr) in p["itens"].items()])
        cur.execute("""insert into pedido (semana_rota_id, cliente_id, tipo, forma_pagamento, cidade_distribuicao_id, reposicao, total, status, observacao, criado_em)
                       select s.id, c.id, t.tipo, t.forma, cd.id, t.reposicao, t.total, t.status, t.observacao, t.criado_em
                       from tmp_pedido t join rota r on r.nome=t.rota join semana_rota s on s.rota_id=r.id and s.data_entrega=t.data
                       join cidade_distribuicao cd on cd.nome=t.distribuicao left join cliente c on c.codigo=t.codigo
                       where t.codigo is null or not exists (select 1 from pedido p2 where p2.semana_rota_id=s.id and p2.cliente_id=c.id and p2.status<>'EXCLUIDO')
                       order by t.k""")
        cur.execute(r"""create temp table tmp_map on commit drop as
                       select p.id as pedido_id, (regexp_match(p.observacao, '^LEGADO#(\d+) '))[1]::int as k from pedido p where p.observacao like 'LEGADO#%'""")
        cur.execute("create index on tmp_map (k)")
        cur.execute("""insert into pedido_item (pedido_id, produto_id, quantidade, preco_unitario)
                       select mp.pedido_id, pr.id, i.q, i.pr from tmp_item i join tmp_map mp on mp.k=i.k join produto pr on pr.sigla=i.sigla""")
        cur.execute(r"update pedido set observacao = regexp_replace(observacao, '^LEGADO#\d+ ', 'LEGADO ') where observacao like 'LEGADO#%'")

        print("6/8 contatos")
        ev("""insert into contato_cliente (semana_rota_id, cliente_id, resultado, registrado_em)
              select s.id, c.id, v.res, v.data + time '08:00' from (values %s) v(rota, data, codigo, res)
              join rota r on r.nome=v.rota join semana_rota s on s.rota_id=r.id and s.data_entrega=v.data join cliente c on c.codigo=v.codigo
              on conflict (semana_rota_id, cliente_id) do update set resultado=excluded.resultado""",
           [(c["rota"], c["data"], c["codigo"], c["resultado"]) for c in m["contatos"]])

        print("7/8 títulos")
        cur.execute("create temp table tmp_titulo (k int, codigo int, data date, rota text, valor numeric, forma text, situacao text, data_baixa date, motivo text, criado_em timestamptz, email text) on commit drop")
        ev("insert into tmp_titulo values %s",
           [(k, t["codigo"], t["data"], t["rota"], t["valor"], t["forma"], t["situacao"], t["data_baixa"], t["motivo"], t["criado_em"], t["email"]) for k, t in enumerate(m["titulos"])])
        cur.execute("""insert into titulo (pedido_id, cliente_id, data_referencia, valor, forma_pagamento, situacao, data_baixa, motivo, criado_em, criado_por)
                       select (select p.id from pedido p join semana_rota s on s.id=p.semana_rota_id join rota r on r.id=s.rota_id
                               where p.cliente_id=c.id and s.data_entrega=t.data and r.nome=t.rota and p.tipo='CLIENTE' limit 1),
                              c.id, t.data, t.valor, t.forma, t.situacao, t.data_baixa, t.motivo, coalesce(t.criado_em, now()),
                              (select id from usuario where email=t.email)
                       from tmp_titulo t join cliente c on c.codigo=t.codigo order by t.k""")
        cur.execute("""update titulo t set cancelado_por_id = (select t2.id from titulo t2 where t2.cliente_id=t.cliente_id and t2.data_referencia=t.data_referencia
                       and t2.situacao<>'CANCELADO' and t2.criado_em>=t.criado_em order by t2.criado_em limit 1) where t.situacao='CANCELADO' and t.motivo like 'LEGADO%'""")

        print("8/8 pedidos à granja")
        for x in m["pf"]:
            cur.execute("""insert into pedido_fornecedor (data_entrega, cidade_distribuicao_id, fornecedor_id, status, registrado_em, observacao)
                           values (%s, (select id from cidade_distribuicao where nome=%s), (select id from fornecedor order by id limit 1), 'ENTREGUE', coalesce(%s, now()), 'LEGADO')
                           on conflict (data_entrega, cidade_distribuicao_id) do update set registrado_em=excluded.registrado_em returning id""", (x["data"], x["cidade"], x["registrado_em"]))
            pfid = cur.fetchone()[0]
            cur.execute("delete from pedido_fornecedor_item where pedido_fornecedor_id=%s", (pfid,))
            siglas = set(x["qtd"]) | set(x["programado"])
            if siglas:
                ev("insert into pedido_fornecedor_item (pedido_fornecedor_id, produto_id, qtd_programada, qtd_pedida) select %s, p.id, v.prog, v.ped from (values %%s) v(sigla, prog, ped) join produto p on p.sigla=v.sigla" % pfid,
                   [(s_, x["programado"].get(s_, 0), x["qtd"].get(s_, 0)) for s_ in siglas])
        cn.commit()
        print("Carga concluída.")
        reconciliar(cur, m)
    except Exception:
        cn.rollback()
        raise
    finally:
        cn.close()


def reconciliar(cur, m):
    print("\n== Reconciliação ==")
    checks = [
        ("C1 clientes ativos", "select count(*) from cliente where tipo='CLIENTE' and ativo", sum(1 for c in m["clientes"] if c["tipo"] == "CLIENTE" and c["ativo"])),
        ("C2 preços", "select count(*) from preco_cliente", len(m["precos"])),
        ("C3 vínculos rota×cliente", "select count(*) from rota_cliente", len(m["rota_cliente"])),
        ("C4 pedidos fechados", "select count(*) from pedido where status='FECHADO'", sum(1 for p in m["pedidos"] if p["status"] == "FECHADO")),
        ("C5 Σ total fechado", "select coalesce(sum(total),0) from pedido where status='FECHADO'", round(sum(p["total"] for p in m["pedidos"] if p["status"] == "FECHADO"), 2)),
        ("C7 Σ reposição", "select coalesce(sum(reposicao),0) from pedido", sum(p["reposicao"] for p in m["pedidos"])),
        ("C8 contatos", "select count(*) from contato_cliente", len(m["contatos"])),
        ("C9 títulos", "select count(*) from titulo", len(m["titulos"])),
        ("C10 Σ pendente", "select coalesce(sum(valor),0) from titulo where situacao='PENDENTE'", round(sum(t["valor"] for t in m["titulos"] if t["situacao"] == "PENDENTE"), 2)),
        ("C12 pedidos fornecedor", "select count(*) from pedido_fornecedor", len(m["pf"])),
        ("C14 semanas abertas duplicadas", "select count(*) - count(distinct rota_id) from semana_rota where status='ABERTA'", 0),
    ]
    for nome, sql, esperado in checks:
        cur.execute(sql)
        obtido = cur.fetchone()[0]
        ok_ = abs(float(obtido) - float(esperado)) < 0.01
        print(f"  {'OK ' if ok_ else 'DIF'} {nome}: banco={obtido} esperado={esperado}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--admin", default="../Admin.xlsx")
    ap.add_argument("--vendas", default="../VENDAS - Agro Aves Distribuidora.xlsx")
    ap.add_argument("--dsn", help="postgresql://... (Supabase > Settings > Database). Sem ele só gera CSVs")
    ap.add_argument("--saida", default=os.path.join(os.path.dirname(__file__), "saida"))
    a = ap.parse_args()
    bruto = extrair(a.admin, a.vendas)
    modelo = transformar(bruto)
    print(f"clientes={len(modelo['clientes'])} precos={len(modelo['precos'])} rota_cliente={len(modelo['rota_cliente'])} pedidos={len(modelo['pedidos'])} contatos={len(modelo['contatos'])} titulos={len(modelo['titulos'])} pf={len(modelo['pf'])} semanas={len(modelo['semanas'])}")
    gravar_csv(modelo, a.saida)
    if a.dsn:
        carregar(modelo, a.dsn)
