# C2.5 — Privilégios SECURITY DEFINER e Etapa 3 (identidade/autoria)

Execução exclusiva no runner local descartável (`run_c2.sh`: socket `/tmp/epi-c2-pg`, porta 55433, banco `epi_c2_staging`, TCP desativado). Nenhuma conexão com a operação In-Haus. Evidência: `results_c2_5.log` (EXIT 0).

## Parte A — Owner das funções
- Owner no replay: `lovable` — SUPERUSER=t, BYPASSRLS=t, 0 memberships. Privilégios amplos → simulação necessária.
- Roles de teste (NOLOGIN, NOINHERIT, NOSUPERUSER, sem CREATEDB/CREATEROLE), criadas e removidas pelo teste:
  - `c2_definer_bypass`: BYPASSRLS (equivalente ao `postgres` operacional: rolsuper=false, rolbypassrls=true).
  - `c2_definer_nobypass`: sem BYPASSRLS.
- Grants mínimos: USAGE em `public`, `app_auth`, `auth`; EXECUTE em `app_auth.has_role`, `auth.uid`, `auth.jwt`; SELECT em `epis`, `inventarios`, `inventario_itens`; SELECT/INSERT/UPDATE/DELETE em `movimentacoes`; UPDATE em `epis`, `inventarios`. Sem acesso a `auditoria`/`user_roles` (triggers e `has_role` já são SECURITY DEFINER).
- Ownership alterado dentro de transação e revertido por ROLLBACK.

| Operação | Owner NOSUPERUSER + BYPASSRLS | Owner NOSUPERUSER NOBYPASSRLS |
|---|---|---|
| registrar_entrada_estoque | OK | Falha: RLS em `movimentacoes` (42501) |
| registrar_entrega_multipla | OK | Falha: EPI invisível por RLS |
| excluir_entrega | OK | Falha: entrega invisível por RLS |
| editar_entrega | OK | Falha: entrega invisível por RLS |
| finalizar_inventario | OK | Falha: inventário invisível por RLS |

Conclusão: as operações **não dependem de SUPERUSER**, mas **dependem de BYPASSRLS** do owner (as policies são `TO authenticated`). Isso corresponde ao catálogo operacional e não é defeito do patch C2.4, que não foi alterado. Remover BYPASSRLS exigiria policies para a role owner ou `FORCE RLS` redesenhado — fora do escopo.

## Parte B — Matriz de identidade
| RPC | `p_usuario` controlava | Tratamento C2.5 |
|---|---|---|
| registrar_entrega_multipla | Autoria (entrega e troca automática) | `auth.uid()` obrigatório (42501), papéis admin/técnico/almoxarife, autoria = `auth.uid()`; parâmetro mantido e ignorado |
| finalizar_inventario | Autoria dos ajustes; sem autorização alguma | `auth.uid()` obrigatório, papéis admin/técnico/almoxarife (mesmos da policy de UPDATE em `inventarios`), autoria = `auth.uid()`; parâmetro ignorado |
| registrar_entrada_estoque | Autoria | Já corrigida na C2.3 — sem mudança |
| excluir_entrega | Autorização | Já corrigida na C2.3 — sem mudança |
| editar_entrega | Não recebe | Já usa `auth.uid()`; sessão sem usuário falha em `has_role` — sem mudança |
| excluir_colaborador_seguro / excluir_epi_seguro | Não recebem | Sem mudança |
| registrar_entrega_atomica | Autoria | EXECUTE revogado (C2.3) — sem mudança |

`service_role`: nenhum fluxo de serviço chama essas RPCs (o único uso de serviço no app é a gestão de usuários em `profiles`/`user_roles`). Grants e privilégios de tabela de `service_role` foram comparados antes/depois e estão idênticos; `service_role` sem `sub` não é tratado como humano e é rejeitado nas operações com autoria. Nenhum `COALESCE(auth.uid(), p_usuario)`. Nenhum privilégio novo.

## Arquivos
- Novo: `c2_corrections/03_identity_authorship.sql` (transacional, trava de destino local, `CREATE OR REPLACE` preservando OID/owner/ACL/`proconfig`).
- Novos: `tests/test_c2_definer.py`, `tests/test_c2_identity.py`, `RESULTS_C2_5.md`, `results_c2_5.log`.
- Alterados: `tests/run_c2.sh` (Parte A, Etapa 3 aplicada 2x, regressões), `tests/test_c2.py` e `tests/test_c2_boundary.py` (ignoram somente os corpos das 2 funções alteradas e, em modo Etapa 3, ACLs de tabela já cobertas pelos testes da Etapa 2).

## Testes (todos aprovados)
| Suíte | Testes |
|---|---|
| Etapa 1 (C2.3) | 20 |
| Etapa 2 (C2.4) | 45 |
| Parte A antes da Etapa 3 | 5 |
| Etapa 3 identidade | 12 (com subcasos) |
| Parte A após a Etapa 3 | 5 |
| Regressão Etapa 1 após Etapa 3 | 20 |
| Regressão Etapa 2 após Etapa 3 | 45 |

Etapa 3 cobre: `p_usuario` forjado (outro usuário, UUID desconhecido, NULL) em entrega, troca automática, ajuste de inventário e entrada; sem perfil/líder/UUID desconhecido negados; sessão sem identidade (authenticated, anon, service_role) negada nas 5 RPCs; `user_metadata` sem efeito; autoria em `movimentacoes` = auditoria = `auth.uid()`; edição/exclusão por admin; contratos idênticos; privilégios de `service_role` idênticos; reaplicação idempotente; patch rejeitado em banco errado; autoria histórica intacta.

## Compatibilidade
Assinaturas, nomes de parâmetros, retornos, owner, `SECURITY DEFINER`, `search_path` e ACLs idênticos. O frontend continua enviando `p_usuario` e funciona sem alteração.

## Limitações e pendências
- `auth.uid()` via camada de compatibilidade local; sem JWT assinado nem PostgREST real.
- Replay de migrations, não réplica certificada do catálogo operacional.
- `editar_entrega` mantém erro P0001 (não 42501) para perfil não autorizado — comportamento preexistente.
- Concorrência, idempotência e autosave de `finalizar_inventario` (Etapa 4) não tratados; reexecução sobre inventário finalizado continua possível.
- Saldo de posse ainda inclui `devolucao_normal` no corpo preexistente (não reintroduzido nem alterado).
- Dependência de BYPASSRLS do owner documentada, não resolvida.

**A operação In-Haus permaneceu intocada.**
