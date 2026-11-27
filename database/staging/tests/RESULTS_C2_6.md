# C2.6 — Etapa 4: integridade transacional e concorrência do inventário

Executado **somente** no PostgreSQL local descartável (`/tmp/epi-c2-pg`, porta 55433, banco
`epi_c2_staging`, TCP desativado, `env -i`, trava de destino no início de cada patch). Nenhuma conexão
com o banco In-Haus/Lovable Cloud; nenhum arquivo de frontend alterado; nenhum build executado.
O cluster foi parado e descartado ao fim. Evidência integral: `results_c2_6.log`.

## 1. Arquivos
- Criado `database/staging/c2_corrections/04_inventario_concurrency.sql`
- Criado `database/staging/tests/test_c2_inventory.py`
- Alterado `database/staging/tests/run_c2.sh` (Etapa 4 aplicada 2x + regressões + suíte C2.6)
- Alterado `database/staging/tests/test_c2.py` (modo `C2_STAGE=4`: ignora apenas o corpo de
  `excluir_inventario` e os objetos novos da Etapa 4; demais comparações mantidas)
- Criados `results_c2_6.log` e este relatório

## 2. O que o patch faz
| Objeto | Comportamento |
|---|---|
| `trg_validar_inventario_item_status` (BEFORE INSERT/UPDATE/DELETE em `inventario_itens`) | `FOR SHARE` no cabeçalho; finalizado → `23514`; cabeçalho inexistente → `23503`; transferência trava os 2 cabeçalhos em ordem UUID; DELETE em cascata do próprio cabeçalho permitido |
| `finalizar_inventario(uuid,uuid)` | contrato e autoria C2.5 (`auth.uid()`, admin/técnico/almoxarife); existência por `FOUND` do `FOR UPDATE` (`P0002`); já finalizado → `22000` sem efeitos; EPIs divergentes travados em ordem UUID; ajustes só com `quantidade_contada IS NOT NULL`; `ajuste_entrada`/`ajuste_saida`, motivo `Ajuste de inventário`, observação `Inventário "<local>"`, `data_fim = now()` |
| `excluir_inventario(uuid)` | só admin com `auth.uid()` (`42501`); itens `FOR UPDATE` (ordem id) → cabeçalho `FOR UPDATE`; finalizado → `22000`; inexistente → `P0002` |

Ordem de locks: escrita de item = item → cabeçalho (SHARE); exclusão = itens → cabeçalho; finalização =
cabeçalho → EPIs. A finalização **não** trava itens, para não formar ciclo com o autosave.
Mensagens de erro anteriores preservadas; os SQLSTATE passaram de `P0001` genérico para códigos específicos.

## 3. Testes executados
| Suíte | Execuções | Resultado |
|---|---|---|
| C2.3 (`test_c2.py`) — base, pós-Etapa 3, pós-Etapa 4 | 20 × 3 | aprovado |
| C2.4 (`test_c2_boundary.py`) — 3 rodadas | 45 × 3 | aprovado |
| C2.5 Parte A (`test_c2_definer.py`) — 3 rodadas | 5 × 3 | aprovado |
| C2.5 Parte B (`test_c2_identity.py`) — 2 rodadas | 12 × 2 | aprovado |
| C2.6 funcional (`test_c2_inventory.py`) | 13 | aprovado |
| C2.6 concorrência real | 8 cenários (6 pedidos, 2 com as duas ordens) | aprovado |
| **Total** | **255 execuções, 0 reprovações** | |

Rodadas anteriores: 1ª e 2ª falharam só no teste 12 da C2.6 por expectativa de formato
(`true|false` vs `t|f` na concatenação de booleanos); corrigido o teste, sem mudar o patch.

Cobertura funcional: INSERT/UPDATE/DELETE em andamento (admin, técnico, almoxarife); rejeição em
finalizado; transferência (válida, para finalizado, de finalizado); cabeçalho inexistente (item,
finalizar, excluir, transferência); diferença positiva/negativa/zero; item sem contagem preservado
NULL; segunda finalização; exclusão em andamento e cascata pela FK; exclusão de finalizado;
autorização por perfil; identidade ausente (authenticated/anon/service_role); reaplicação idêntica
(OID, ACL, owner, hash do corpo, 1 trigger); contratos/grants; rejeição em banco errado.

## 4. Concorrência — evidência real
Cada sessão é um processo `psql` próprio. O bloqueio foi comprovado por uma terceira conexão via
`pg_blocking_pids()`, `pg_stat_activity` e `pg_locks` (lock não concedido). Em todos os casos:
`wait_event_type=Lock`, `wait_event=transactionid`, `ShareLock` pendente no xid da sessão bloqueadora.

| # | Cenário | Bloqueada → bloqueadora | SQLSTATE | Resultado |
|---|---|---|---|---|
| 1a | autosave aberto, depois finalização | finaliza → autosave | — / — | finalização esperou e usou a contagem confirmada (+4) |
| 1b | finalização aberta, depois autosave | autosave → finaliza | — / `23514` | contagem fechada preservada |
| 2a | autosave aberto, depois exclusão | exclui → autosave | — / — | cabeçalho e itens removidos |
| 2b | exclusão aberta, depois autosave UPDATE e INSERT | ambos → exclui | — / — / `23503` | UPDATE sem efeito, INSERT rejeitado, sem órfãos |
| 3 | duas finalizações | finaliza2 → finaliza1 | — / `22000` | um único ajuste (+2) |
| 4 | finalização × entrega múltipla (mesmo EPI) | entrega → finaliza | — / — | estoque 30 → 34 (+5 −1) |
| 5 | finalização × entrada de estoque | entrada → finaliza | — / — | estoque 49 → 58 (+5 +4) |
| 6 | finalização × edição de entrega | edição → finaliza | — / — | estoque 15 → 19 (+5 −1) |

PIDs e xids de cada caso estão nas linhas `EVIDENCIA` do log.

## 5. Deadlocks e timeouts
Log do servidor ao fim da suíte: `deadlock detected` = 0, timeout de comando = 0, timeout de lock = 0;
nenhuma sessão retornou `40P01` ou `57014`. **Vale só para os cenários acima.** Não foi testado:
entrega múltipla com vários EPIs em ordem diferente da UUID concorrendo com finalização que ajusta
os mesmos EPIs. A entrega múltipla ainda trava EPIs na ordem do payload (pelo gatilho de estoque), então
um deadlock nesse caso continua possível até que ela também trave em ordem canônica.

## 6. Limitações
- Sem PostgREST/JWT assinado real; `auth.uid()` vem da camada de compatibilidade local.
- Owner local é o superusuário do cluster descartável (no operacional: `postgres` com BYPASSRLS — C2.5 Parte A).
- O frontend deve tratar `23514` (inventário fechado durante edição) e `22000` (já finalizado) com
  mensagem amigável; nenhuma alteração de tela foi feita.
- Banco operacional não alterado; aplicação real depende de homologação no staging Supabase dedicado.
