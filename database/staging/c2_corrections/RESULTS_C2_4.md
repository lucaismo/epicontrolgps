# C2.4 — Proteção da fronteira de escrita / Etapa 2

**Resultado:** escopo autorizado concluído exclusivamente no PostgreSQL local descartável, em 26/11/2026. Foram aprovadas **65 execuções de testes**: 20 da C2.3 antes do patch, 26 novas da C2.4 e 19 regressões da C2.3 repetidas depois do patch. São **46 métodos distintos**, com subcasos adicionais; nenhuma falha na execução final.

**Nenhuma conexão ou alteração foi realizada no banco operacional In-Haus.** Não foram utilizadas credenciais operacionais, ferramentas de escrita Cloud ou migrations automáticas. Frontend e RPCs da C2.3 não foram alterados. Etapas 3 e 4 não foram implementadas.

## 1. Arquivos

Criados:
- `database/staging/c2_corrections/02_epis_grants_movimentacoes.sql`: patch transacional incremental, com guarda de destino, revogação por tabela e coluna e validação de privilégios efetivos.
- `database/staging/tests/test_c2_boundary.py`: 26 métodos de teste da Etapa 2 e repetição de 19 regressões anteriores.
- `database/staging/c2_corrections/results_c2_4.log`: evidência integral da execução final, incluindo encerramento do cluster.
- `database/staging/c2_corrections/RESULTS_C2_4.md`: este relatório.

Alterados:
- `database/staging/tests/run_c2.sh`: executa a suíte da Etapa 1, captura baseline da Etapa 2, aplica o novo patch duas vezes, compara a reaplicação e executa a suíte da fronteira.
- `AGENTS.md`: regra técnica de revogação dos grants independentes e rejeição de permissões herdadas incompatíveis.
- `roadmap.md`: tarefas autorizadas e conclusão local.

Preservados: migrations históricas, seeds, `01_containment_rpcs.sql`, testes anteriores, relatórios C2.3 e todo o frontend. Não há projeto externo provisionado.

## 2. Privilégios removidos e concedidos

### `public.epis`

- Revogado `UPDATE` geral de `authenticated`, `anon` e `PUBLIC`.
- Revogados também os grants independentes de `UPDATE` de todas as colunas para esses mesmos destinatários, antes de reestabelecer a lista permitida. Isso evita que um grant preexistente por coluna sobreviva à revogação do grant da tabela.
- Concedido `UPDATE` somente a `authenticated` nas **11 colunas efetivamente presentes em `basePayload` do EpiForm**:

| Coluna | UPDATE direto por authenticated |
|---|---|
| `nome` | Permitido, sujeito à RLS existente |
| `categoria` | Permitido, sujeito à RLS existente |
| `ca` | Permitido, sujeito à RLS existente |
| `modelo` | Permitido, sujeito à RLS existente |
| `tamanho` | Permitido, sujeito à RLS existente |
| `codigo_produto` | Permitido, sujeito à RLS existente |
| `estoque_minimo` | Permitido, sujeito à RLS existente |
| `custo_unitario` | Permitido, sujeito à RLS existente |
| `dias_seguranca` | Permitido, sujeito à RLS existente |
| `localizacao` | Permitido, sujeito à RLS existente |
| `status` | Permitido, sujeito à RLS existente |
| `estoque_atual` | **Negado — 42501** |
| `id` | **Negado — 42501** |
| `created_at` | **Negado — 42501** |
| `updated_at` | **Negado — 42501** |

`anon` não recebe UPDATE em nenhuma coluna. `updated_at` continua sendo atualizado pelo trigger existente; isso não exige conceder sua edição direta ao cliente.

### `public.movimentacoes`

- Revogado `INSERT` geral de `authenticated`, `anon` e `PUBLIC`.
- Revogados também grants independentes de `INSERT` em todas as colunas para esses mesmos destinatários.
- Nenhum INSERT novo foi concedido. A RLS de INSERT existente não foi removida nem alterada, mas não supera a ausência de privilégio SQL.

### Privilégios preservados

Comparação antes/depois confirmou preservação de SELECT, DELETE, TRUNCATE, REFERENCES e TRIGGER nas duas tabelas; INSERT de EPIs e UPDATE de movimentações também permaneceram iguais ao baseline. Privilégios de `service_role` e do proprietário foram preservados. Nenhuma permissão nova foi concedida a esses papéis.

ACLs finais de tabela no replay local:
- `epis`: `authenticated=ard` (INSERT, SELECT, DELETE); UPDATE somente via ACLs das 11 colunas.
- `movimentacoes`: `authenticated=rwd` (SELECT, UPDATE, DELETE); sem INSERT.

Esses ACLs são do staging reconstruído, não uma afirmação sobre o catálogo operacional atual.

## 3. Por que a restrição não depende do cliente

O PostgreSQL verifica privilégios de tabela e coluna antes de permitir a escrita. O papel `authenticated` não pode editar estoque nem inserir movimentações diretamente, mesmo quando o usuário possui papel operacional admin. Identidade atribuída em payload, metadados editáveis ou flags customizadas não concedem os privilégios removidos.

O patch verifica acesso **efetivo**, incluindo herança: se `authenticated` ou `anon` ainda puderem atualizar uma coluna não permitida ou inserir movimentações por membership/ownership, toda a transação aborta. O teste adicionou permissões herdadas de serviço e, separadamente, um grant herdado somente em `created_at`; ambos provocaram rejeição com rollback. Não há uso de `pg_trigger_depth()` nem de flag customizada para autorizar escrita.

## 4. Funções e triggers preservados

A inspeção estática das migrations e o catálogo reconstruído localizaram quatro funções que inserem diretamente em `movimentacoes`:

| Função | Situação após o patch |
|---|---|
| `registrar_entrada_estoque` | SECURITY DEFINER; entrada autorizada continua inserindo e somando estoque |
| `registrar_entrega_multipla` | SECURITY DEFINER; lote de dois itens, entrega simples pelo mesmo contrato e troca automática continuam funcionando |
| `finalizar_inventario` | SECURITY DEFINER; ajustes positivos/negativos existentes continuam inserindo e atualizando saldo |
| `registrar_entrega_atomica` | Capacidade interna do proprietário preservada; EXECUTE de authenticated/anon continua revogado pela Etapa 1 |

Todas possuem owner **`lovable` no replay local**, com INSERT efetivo em movimentações e UPDATE efetivo em estoque. Esse owner é o administrador do cluster local; não se alterou ownership para simular o banco operacional. Não se afirma reprodução certificada dos atributos da role operacional.

Também preservados e exercitados:
- `aplicar_movimentacao_estoque` / `trg_aplicar_movimentacao`: SECURITY DEFINER, BEFORE INSERT, com UPDATE de estoque autorizado pelo proprietário.
- `registrar_auditoria` / triggers de auditoria em EPIs, movimentações e inventários: continuam gravando auditoria, com autoria da sessão.
- `set_updated_at` / `trg_epi_updated`: mantém atualização automática do timestamp em edições cadastrais.
- `excluir_entrega` e `editar_entrega`: atualizações diretas internas de estoque continuam funcionando em SECURITY DEFINER.

Nenhum trigger encontrado insere diretamente em movimentações; os INSERTs são das quatro funções acima. O trigger de estoque atualiza EPIs e o de auditoria insere em auditoria. Contratos, OIDs, owners, corpos, configurações e ACLs de **18 funções** permaneceram iguais ao baseline imediatamente anterior à Etapa 2; políticas e definições dos triggers também permaneceram iguais.

## 5. Testes executados

Comando único autorizado:

```bash
bash database/staging/tests/run_c2.sh
```

| Teste C2.4 | Resultado comprovado |
|---|---|
| 01–02 | UPDATE direto de estoque negado com 42501 para authenticated, inclusive admin/técnico/almoxarife, e anon |
| 03–04 | INSERT direto negado para todos os tipos não legados presentes no enum e para anon |
| 05 | Responsável forjado, metadados de admin e flag customizada não concedem escrita |
| 06–07 | Cada coluna não autorizada negada; lista efetiva de UPDATE corresponde exatamente às 11 colunas |
| 08 | Cadastro com payload real, estoque zero e entrada inicial de 5 funciona para admin/técnico e é auditado |
| 09 | Payload completo de edição funciona para admin/técnico/almoxarife, preserva estoque e gera auditoria |
| 10 | Payload misto com nome e estoque proibido é rejeitado sem alteração parcial ou auditoria persistida |
| 11 | Entrada via RPC preserva os três perfis e saldo 8 → 11 |
| 12 | Lote de dois EPIs baixa 20 → 18 e 30 → 29, com duas entregas auditadas |
| 13 | Troca automática mantém saldo anterior em 8, baixa novo EPI 20 → 19 e audita troca/entrega |
| 14 | Exclusão admin restitui saldo 8 → 10 e preserva auditoria |
| 15 | Edição de entrega restitui EPI antigo 8 → 10 e baixa novo EPI 20 → 17 sem duplicação por trigger |
| 16 | Inventário existente ajusta 8 → 11 ou 8 → 6; item não contado permanece em 20 |
| 17 | Falha no segundo item do lote desfaz primeiro item e movimentos/auditoria da transação |
| 18 | Quatro escritores e triggers SECURITY DEFINER mantêm privilégios efetivos do proprietário |
| 19 | Catálogo, contratos, policies, triggers, dados e privilégios não abrangidos permanecem iguais |
| 20 | Segunda aplicação do patch produz snapshot idêntico ao da primeira |
| 21 | Patch rejeita banco local errado antes das revogações |
| 22 | Grants adversariais por coluna e PUBLIC também são removidos |
| 23 | Leituras preservadas: quatro perfis veem 5 EPIs/3 movimentos; usuário sem papel continua sem linhas pela RLS existente |
| 24 | Colunas cadastrais permitidas continuam sujeitas à RLS; líder/sem perfil não alteram o cadastro |
| 25 | Herança de privilégio de serviço ou apenas de created_at provoca aborto atômico do patch |
| 26 | Perda, roubo, avaria e descarte pelo caminho legado administrativo preservam inserções, estoque e auditoria; não representam reabertura da RPC para authenticated |

Os 20 testes da Etapa 1 passaram antes da aplicação; 19 foram repetidos depois e passaram. O teste anterior de imutabilidade total de ACLs de tabelas não é repetido após a Etapa 2, pois essas ACLs são justamente o alvo autorizado; sua verificação foi substituída pela comparação discriminada no teste 19.

Na primeira execução, dois testes tinham expectativas incorretas: ordem lexical dos nomes das funções e leitura para usuário sem papel. Foram corrigidos os testes, sem ampliar grants ou RLS. As execuções finais passaram integralmente, inclusive após acrescentar a validação de herança em todas as colunas não permitidas.

Nenhuma nova inserção ou fluxo `devolucao_normal` foi criada. Referências legadas foram apenas preservadas e o enum inspecionado.

## 6. Incompatibilidades e limites

- **Nenhuma incompatibilidade concreta encontrada no payload existente de cadastro/edição ou nos contratos SQL exercitados.** Não houve necessidade de editar o frontend.
- Não foram executados HTTP/PostgREST, JWT assinado real ou fluxo visual ponta a ponta. Isso requer staging externo independente, não provisionado nem acessado nesta etapa. Não se testou escrita pela aplicação conectada à operação.
- O baseline é reconstruído das migrations históricas com seed sintética, não réplica certificada do catálogo operacional. Permissões de serviço da RPC atômica continuam com a diferença já documentada na C2.3.
- Não foram testados concorrência, autosaves concorrentes, idempotência de finalização de inventário ou ausência de deadlocks. O teste de inventário comprova somente compatibilidade do fluxo existente com os grants novos.
- A proteção de EPIs desta etapa é de **UPDATE**. INSERT de novos EPIs foi preservado para compatibilidade do cadastro; não se afirma bloqueio de estoque não zero em um INSERT direto. DELETE direto, TRUNCATE e outras permissões fora do escopo também não foram contidos por este patch.
- Chamadas legítimas internas continuam sendo autorizadas pelos privilégios/ownership de SECURITY DEFINER existentes. Esta etapa não equivale a homologação de todas as autorizações de todas as RPCs, nem implementa a identidade geral da Etapa 3.
- Resultado **não autoriza aplicação em produção** e não libera outra organização.

## 7. Isolamento e encerramento

- Somente runner `database/staging/tests/run_c2.sh`, ambiente mínimo sem leitura de `.env` ou credenciais Cloud.
- Socket fixo `/tmp/epi-c2-pg`, porta 55433, banco `epi_c2_staging`, diretório `/tmp/epi-c2-pg/data`.
- TCP desativado, socket 0700, validação de servidor antes de criar banco.
- Patch contém a mesma guarda independente de banco, porta, diretório, socket e ausência de TCP.
- Argumentos externos, variáveis PG de conexão e herança incompatível são rejeitados ou descartados conforme os testes.
- Cluster parado e dados descartados ao final; diretório de dados e socket não existem após a execução. Logs e snapshots locais foram preservados para evidência.
- Nenhum build manual, projeto externo ou alteração no banco operacional foi realizado.

**A In-Haus permaneceu intocada.**