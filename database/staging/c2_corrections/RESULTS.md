# C2.3 — Contenção das RPCs críticas / Etapa 1

**Resultado:** concluída exclusivamente no PostgreSQL local descartável; **20 testes aprovados, nenhuma falha na execução final**.

## 1. Arquivos criados e alterados

Criados:
- `database/staging/c2_corrections/01_containment_rpcs.sql`: patch incremental transacional das três RPCs, com trava de destino local.
- `database/staging/c2_corrections/seed_c2.sql`: usuários fictícios de almoxarife, líder e sem perfil, somente para o teste local.
- `database/staging/tests/run_c2.sh`: runner independente, sem aplicar as migrations SaaS anteriores.
- `database/staging/tests/test_c2.py`: 20 testes com subcasos de autorização e regressão.
- `database/staging/c2_corrections/results.log`: evidência integral da execução final aprovada.
- `database/staging/c2_corrections/RESULTS.md`: este relatório.

Alterados:
- `AGENTS.md`: regra de isolamento dos scripts C2.
- `roadmap.md`: registro e conclusão das tarefas autorizadas.

Não foram alterados frontend, arquivos gerados, migrations históricas ou scripts SaaS anteriores. `bun.lock` já estava modificado antes da tarefa e não integra esta entrega.

## 2. Script SQL incremental

Arquivo de implementação: `01_containment_rpcs.sql`, aplicado duas vezes no mesmo banco local para verificar reaplicação idempotente.

### registrar_entrega_atomica

Revogado `EXECUTE` de `authenticated`, `anon` e `PUBLIC` (este último impede herança de permissão). Função, assinatura, corpo e OID preservados; nenhum DROP. Nenhum privilégio de outra RPC foi modificado.

### excluir_entrega

Identidade exclusivamente de `auth.uid()`, rejeitando NULL com SQLSTATE `42501`; administrador validado por `app_auth.has_role(v_usuario, 'admin')`. `p_usuario` permanece na assinatura para compatibilidade, mas é ignorado na autorização. Todo o restante do corpo legado foi preservado, inclusive seleção por colaborador/timestamp e `LIMIT 1`; não houve correção relacional ou associação nova de históricos.

A referência preexistente a `devolucao_normal` no ramo de reversão foi mantida para não mudar o comportamento histórico; não foi criado tipo, inserido movimento nem reativado fluxo desse tipo.

### registrar_entrada_estoque

Identidade de `auth.uid()`, rejeitando NULL com SQLSTATE `42501`. Papéis permitidos: **admin, tecnico e almoxarife**, conforme `canMovimentar` e regras operacionais versionadas. Líder e usuário sem perfil são bloqueados. `p_usuario` permanece no contrato, mas o responsável da nova movimentação é o usuário autenticado. Validação da quantidade, inserção de entrada, trigger de estoque e auditoria preservados.

Nenhuma alteração em RLS, grants de tabelas ou outras funções. Não foram implementadas as Etapas 2, 3 ou 4; os caminhos diretos de escrita continuam fora desta contenção.

## 3. Testes efetivamente executados

Comando:

```bash
bash database/staging/tests/run_c2.sh
```

Execução final: **20 métodos de teste, todos aprovados**, com subcasos para perfis e entradas diferentes.

| Teste | Resultado verificado |
|---|---|
| 01 | Banco, porta, diretório, socket e ausência de conexão TCP correspondem à lista permitida. |
| 02 | Contratos/OIDs/owners/configuração preservados; 12 tabelas, policies, triggers e dados iguais ao snapshot. Corpos/ACLs só diferem nos pontos autorizados. |
| 03 | `authenticated` e `anon` sem EXECUTE na RPC atômica; chamadas reais rejeitadas; privilégio anterior de `service_role` preservado. |
| 04 | Entrada bloqueada para sem perfil, líder, UUID desconhecido e sessão sem usuário, mesmo com `p_usuario` de admin. |
| 05 | Exclusão bloqueada para sem perfil, líder, técnico, almoxarife, UUID desconhecido e sessão sem usuário, mesmo com `p_usuario` de admin. |
| 06 | Anônimo não executa entrada/exclusão, mesmo com claim sintético de admin. |
| 07 | Metadados editáveis indicando admin não concedem autorização. |
| 08 | Admin/técnico/almoxarife registram entrada: estoque de 8 passa a 11; movimento e auditoria identificam o usuário autenticado. |
| 09 | Técnico autorizado pode enviar `p_usuario` de outro admin ou NULL; identidade gravada continua sendo a sessão do técnico. |
| 10 | Quantidade zero, negativa ou NULL continua rejeitada. |
| 11 | Admin exclui entrega mesmo com `p_usuario` diferente ou NULL: restitui 2 unidades, remove a entrega e registra auditoria DELETE. |
| 12 | Caso sintético com uma entrega e uma troca no mesmo timestamp mantém a exclusão pareada e restitui somente a entrega. |
| 13 | Entrega inexistente ou movimento que não é entrega continua rejeitado. |
| 14 | EPI inexistente produz falha de FK e rollback, sem alteração persistida no estoque. |
| 15 | RPC de entrega múltipla não alterada continua retornando 1, baixando estoque de 30 para 29 e produzindo auditoria. |
| 16 | Chamada com papel de serviço sem usuário não executa as operações protegidas no replay local. |
| 17 | Runner rejeita argumentos de host externo, porta ou banco alternativo antes da inicialização. |
| 18 | Variáveis PG de ambiente apontando para host externo, serviço ou banco diferente são descartadas. |
| 19 | Dados sintéticos de todas as tabelas permanecem iguais ao baseline depois dos testes (transações com rollback). |
| 20 | Patch SQL rejeitado no banco local `postgres` pela trava de destino, antes de qualquer alteração da contenção. |

Foram preservados **18 objetos de função** nos schemas comparados e **12 triggers não internos** do replay (11 operacionais públicos e 1 de ciclo de usuário). Os testes exercitaram os triggers de estoque, atualização e auditoria nos fluxos legítimos de entrada, exclusão e entrega múltipla; não se afirma cobertura funcional integral de cada trigger.

Houve duas tentativas preliminares: a primeira interrompeu na pré-validação por ausência de Python no PATH mínimo, antes de criar banco; a segunda teve 18 dos 19 testes aprovados e revelou uma expectativa incorreta sobre EXECUTE de `service_role`. A execução final corrigida passou integralmente. A implementação não foi ampliada para conceder esse privilégio.

## 4. Limitações e testes pendentes

- O replay das migrations versionadas não concede EXECUTE de `registrar_entrega_atomica` a `service_role`, diferentemente do catálogo operacional reportado nas auditorias anteriores. A contenção preserva o ACL existente; a suíte compara antes/depois, sem inventar grants. Homologação de ACLs reais exige staging independente.
- `auth.uid()` é exercitado pela camada local de compatibilidade e claims sintéticos. Nenhum JWT assinado real, gateway HTTP ou PostgREST foi testado.
- Fluxo visual autenticado ponta a ponta contra staging externo permanece pendente de provisionamento. Não se usou o aplicativo conectado à operação para testar escrita.
- Concorrência/deadlocks, autosave/finalização de inventário e demais etapas não foram executados nesta tarefa. Não há afirmação de ausência de deadlocks nem liberação para produção.
- O baseline é reconstruído das migrations versionadas com dados sintéticos; não é dump nem réplica certificada do catálogo atual da operação.

## 5. Isolamento utilizado

- Ferramentas: `psql (PostgreSQL) 17.12` e Python local.
- Socket: `/tmp/epi-c2-pg`.
- Porta: `55433`.
- Diretório de dados: `/tmp/epi-c2-pg/data`.
- Banco descartável: `epi_c2_staging`.
- Conexões TCP desativadas: `listen_addresses=''`; socket com permissão `0700`.
- Ambiente reiniciado sem credenciais Cloud, PG ou serviços de conexão; `.env` não é lido.
- Todos os comandos de banco usam host/socket, porta, usuário e banco explícitos. Servidor é verificado por consulta somente leitura antes do primeiro `createdb`.
- Diretório simbólico, cluster preexistente, runner simultâneo e argumentos de conexão são rejeitados.
- Patch SQL possui validação própria de nome do banco, porta, data directory, socket e TCP desativado antes de executar REVOKE/CREATE.
- Cluster final parado, diretório de dados descartado e socket removido; logs preservados.

**Nenhuma conexão ao banco operacional, ferramenta de alteração Cloud, migration automática ou escrita em produção foi realizada nesta tarefa.** Não foram lidos dados ou credenciais operacionais. Nenhum build manual foi executado; apenas a verificação automática habitual do projeto permaneceu ativa.

## 6. Compatibilidade com o frontend

Inspecionados os consumidores de `registrar_entrada_estoque` em `src/routes/_app/epis.tsx`, o consumidor de `excluir_entrega` e os contratos em `src/integrations/supabase/types.ts`.

- Nomes/tipos/ordem dos parâmetros e retorno `void` preservados, incluindo `p_usuario`.
- Chamadas reais com parâmetros nomeados passaram nos testes locais.
- Regras de entrada preservam os mesmos três perfis exibidos pelo frontend.
- Nenhum consumidor ativo de `registrar_entrega_atomica` foi encontrado em `src` pela busca inicial; sua revogação é intencional.
- **Nenhuma incompatibilidade de assinatura encontrada.** A mudança intencional de identidade impede atribuir novas entradas a outro usuário por `p_usuario`; chamadas sem sessão ou perfil autorizado agora falham.
- A validação HTTP/visual contra ambiente independente ainda está pendente; não se afirma teste ponta a ponta do frontend.
