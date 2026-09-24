# Consolidação: tamanhos, estoque mínimo, inventário e paginação

## 1. Tamanhos por colaborador (reutiliza `colaborador_tamanhos`)
- **Novo colaborador**: no formulário, nova seção "Tamanhos de EPI" com Camisa, Calça e Bota (opcionais). Depois de salvar o colaborador, grava só os campos preenchidos. Vazio = pendente, nada inventado.
- **Editar colaborador**: mesma seção, pré-preenchida; quando um campo é apagado, o registro correspondente é removido.
- **Listagem**: nova coluna "Tamanhos" com "Completo" (Camisa + Calça + Bota) ou "Pendente", calculada a partir de uma consulta em `colaborador_tamanhos`.
- **Ficha**: Camisa, Calça e Bota aparecem primeiro como principais; os demais itens continuam como estão. Permissões mantidas.
- **Entregas**: nada muda (já sugere pelo tamanho, não bloqueia e não grava tamanho).

## 2. Mesma regra de nível de estoque
Divergência confirmada: o Dashboard calcula crítico/zerado/abaixo do mínimo com o `estoque_minimo` cadastrado, enquanto EPIs e Compras usam o `minimoEfetivo` do motor (mínimo calculado pelo consumo, ou o cadastrado quando não há consumo).
- Correção só na origem: o Dashboard passa a usar `calcularLinha` do motor via `useEpiMetrics` (`nivel`, `minimoEfetivo`, `ruptura`). A fórmula não muda.
- Com isso, os números do Dashboard podem mudar e passar a bater com os da tela de EPIs.

## 3. Mínimo operacional x segurança da compra
Não muda a política. Vou apenas acrescentar um comentário no motor diferenciando:
- **Mínimo operacional**: consumo diário × (período sem reposição + 7 dias). Usado no nível de estoque.
- **Estoque de segurança da compra**: `dias_seguranca` do EPI. Usado na compra sugerida.

## 4. Inventário
- Mudança mínima no banco: `local` passa a aceitar vazio (DROP NOT NULL) e entra uma coluna nova, opcional, `descricao`. Nada é apagado e os registros antigos ficam iguais.
- Novo inventário: não pede mais local. O nome é gerado automaticamente, por exemplo "Inventário de estoque - 24/09/2026 15:30", e a descrição é opcional. O inventário inclui todos os EPIs ativos (hoje o filtro é feito pela localização).
- Inventários antigos continuam mostrando o `local` como nome. A opção "Editar local" passa a se chamar "Editar descrição".

## 5. Paginação
Há exatamente duas consultas com limite fixo em `dashboard.tsx`:
- **"Movimentações do período"** (chave `dashboard-movs`): busca todos os tipos entre o início e o fim do período, junto com os dados de EPI e colaborador, e usa `.limit(20000)`.
- **"Evolução de 6 meses"** (chave `dashboard-evolucao`): busca todos os tipos a partir de 6 meses atrás e usa `.limit(50000)`.

As duas passam a usar lotes de 1.000, com o mesmo loop por `range` de `consumo.ts`. Para isso entra em `consumo.ts` uma função auxiliar genérica e pequena (`fetchPaginado`), que recebe a consulta montada. `fetchEntregasDesde` continua com o mesmo contrato, e EPIs e Compras não são alterados. Filtros, colunas e resultados continuam os mesmos.

## Preservado
Movimentações, histórico, estoque, pedidos, ajustes, auditoria, RLS, permissões, rotas, cálculo de compras, troca automática, consumo, a tabela `colaborador_tamanhos` e o comportamento atual das entregas. Os tamanhos não serão preenchidos a partir das entregas antigas. Mínimo operacional e segurança da compra continuam como conceitos separados.

## Validação
Somente com dados reais, sem criar dados de teste:
- Tamanhos: cadastro de Camisa, Calça e Bota; edição e remoção; situação Completo/Pendente. As situações serão conferidas por leitura; gravar um cadastro real depende de uma sessão autorizada.
- Dashboard e EPIs: mesmas contagens de zerados, críticos, atenção e ruptura, comparadas no mesmo conjunto de dados.
- Compras: mesmos valores de antes, já que a tela não é alterada.
- Inventários: os antigos continuam iguais (contagem e `local` antes e depois da mudança no banco); o novo não exige Local e inclui todos os EPIs ativos.
- Paginação: as consultas identificadas não usam mais `.limit(20000)` nem `.limit(50000)`.
- Histórico: contagem de movimentações inalterada (1.863).
- Typecheck/build executado uma única vez, no final. Relatório final no formato pedido.

## Arquivos
- `src/routes/_app/colaboradores.tsx`: tamanhos no formulário e coluna "Tamanhos".
- `src/routes/_app/colaboradores_.$id.tsx`: Camisa, Calça e Bota primeiro.
- `src/routes/_app/dashboard.tsx`: nível de estoque pelo motor e paginação.
- `src/routes/_app/inventario.tsx`: novo inventário sem Local, com Descrição.
- `src/lib/estoque-calc.ts`: somente comentário.
- `src/lib/consumo.ts`: função auxiliar de paginação.
- 1 migration: `inventarios.local` DROP NOT NULL + `descricao text` opcional.

Nenhum outro arquivo. O arquivo de tipos do banco é atualizado automaticamente após a migration.
