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
O Dashboard ainda usa consultas com `.limit(20000)` e `.limit(50000)`. Vou trocar pela mesma estratégia de lotes de 1.000 de `consumo.ts`, generalizando a função atual para aceitar filtros sem duplicar código. EPIs e Compras já usam `fetchEntregasDesde`.

## Preservado
Movimentações, histórico, estoque, pedidos, ajustes, auditoria, RLS, permissões, rotas, cálculo de compras, troca automática e consumo.

## Validação
Com dados reais, sem criar dados de teste: typecheck/build uma única vez no final; o Dashboard e a tela de EPIs devem mostrar as mesmas contagens; Compras deve mostrar os mesmos valores de antes; checagem por leitura dos inventários antigos. A validação visual depende de uma sessão autorizada na prévia. Relatório final no formato pedido.

## Arquivos
colaboradores.tsx, colaboradores_.$id.tsx, dashboard.tsx, inventario.tsx, estoque-calc.ts (só comentário), consumo.ts, e 1 migration (inventarios: local opcional + descricao).
