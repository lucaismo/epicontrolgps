# Auditoria e plano de redesign — EPI Control

Escopo desta etapa: só diagnóstico e plano. Não mexo em código, banco, regras ou cálculos.

## 1. Diagnóstico

### Crítico
- **O Dashboard mostra o estado atual, mas não a tendência nem a ação.** Os KPIs e o bloco "Atenção necessária" dizem *o que está acontecendo*. Não dizem *o que está piorando* (falta comparar com o período anterior), *o que vai acontecer* (data prevista de ruptura) nem *o que fazer* (ação direta na linha). São cerca de 25 cards na tela, todos com o mesmo peso visual.
- **Cada tela tem um tamanho de título e de número diferente.** O título é text-2xl/3xl na maioria das telas, mas text-3xl/4xl em Compras e Consumo. Os KPIs ficam entre 2xl e 3xl sem critério. Por isso as telas parecem vir de sistemas diferentes.
- **As tabelas não seguem um padrão.** A classe `.tbl` só é usada em algumas telas. Em Relatórios há 12 tabelas, cada uma montada de um jeito. Status, números e ações não ficam sempre na mesma posição.
- **Entrega no celular:** é a operação mais frequente, mas o formulário segue o layout do computador. A seleção de colaborador e de EPI em listas suspensas longas é lenta no celular.

### Importante
- **Menu lateral:** "Consumo mensal" está em Operação, mas é uma tela de análise. Relatórios aparece sozinho em "Gestão". "Entregas" não se destaca como a ação principal.
- **Não há cabeçalho de página padrão.** Título, subtítulo, período e ações principais mudam de lugar em cada tela.
- **Os filtros mudam de tela para tela.** Consumo tem 5 filtros em linha, Colaboradores e EPIs usam busca solta e o período do Dashboard fica separado dos filtros. Não aparecem os filtros ativos nem um botão "limpar".
- **Os formulários de cadastro seguem a ordem do banco** (por exemplo, o cadastro de EPI vai de categoria a código e CA). A ordem deveria seguir a tarefa: identificação, estoque e reposição, conformidade (CA e validade).
- **Os estados de carregando, vazio e erro mudam de tela para tela** (às vezes um ícone girando, às vezes nada).
- **Os números não ficam alinhados em todas as tabelas.** Coberturas como "28 dias" aparecem só como texto, sem nenhuma barra ou indicação visual.

### Melhoria
- A fonte padrão é Inter, que é genérica. Uma fonte de números mais técnica reforçaria a ideia de "controle".
- O verde, o amarelo e o vermelho de status existem, mas não são usados com o mesmo sentido em todas as telas.
- A ficha do colaborador é uma lista de seções. Falta uma linha do tempo, que é a base do futuro Ciclo de Vida do EPI.
- Faltam mini gráficos de tendência nas linhas de EPI, em Compras e no Dashboard.

## 2. Princípios de redesign
1. **Toda tela responde: o que está acontecendo, o que exige atenção e o que fazer.**
2. **Prioridade antes do volume:** o que é crítico aparece primeiro e com mais peso. O que está normal fica discreto.
3. **Números são o conteúdo:** números grandes, alinhados e sempre com contexto (comparação, unidade, tendência).
4. **Densidade operacional:** linhas compactas e menos cards decorativos. Um card só existe se ajuda a decidir algo.
5. **Uma linguagem de status:** os mesmos níveis e as mesmas cores em todas as telas.
6. **Ação junto do problema:** cada alerta já leva à ação (entregar, comprar, inventariar).
7. **Estrutura previsível:** cabeçalho, filtros, indicadores e conteúdo sempre na mesma ordem.
8. **Celular para operar, computador para analisar:** entrega e consulta pensadas primeiro para o celular.

## 3. Arquitetura visual proposta
- **Menu lateral:** grupos Operar (Entregas em destaque, Inventário), Planejar (Compras, Consumo), Cadastros e Admin. Um contador de alertas ao lado de Compras e EPIs. O menu fica compacto e escuro, como hoje.
- **Cabeçalho de página (componente único):** título, uma linha de contexto (período e última atualização), ações principais à direita e, logo abaixo, a barra de filtros.
- **Central (Dashboard):** uma faixa de 4 indicadores com comparação ao período anterior e seta de tendência. Abaixo, uma fila de prioridades: lista ordenada por gravidade, com "ruptura em X dias" e um botão de ação em cada linha. Depois, a seção "Tendências" com os gráficos, e no fim uma coluna lateral de sinais recentes.
- **Tabelas:** um padrão único (`.tbl` evoluída). Primeira coluna com o item e um subtítulo, depois status, números alinhados à direita e as ações no fim, visíveis ao passar o mouse. Opção de linhas compactas. Cabeçalho fixo ao rolar.
- **Cards:** só para indicadores e alertas, sem cards decorativos.
- **Filtros:** uma barra padrão com busca, seletores e etiquetas dos filtros ativos com "limpar".
- **Indicadores:** valor, rótulo, comparação e uma tendência opcional, em três tamanhos fixos.
- **Alertas:** três níveis (crítico, atenção, informação), com o mesmo formato e sempre com uma ação.
- **Gráficos:** poucos, focados em tendência. Mini gráfico de tendência embutido nas tabelas.
- **Páginas de detalhe:** resumo no topo (status, posse, últimas trocas), abas e linha do tempo. É a base do Ciclo de Vida do EPI.

**Onde entram os conceitos futuros (sem implementar agora):**
- Ciclo de Vida do EPI: linha do tempo na ficha do colaborador e no detalhe do EPI.
- Reposição antecipada, colaboradores fora da janela esperada e EPIs sem entrega prevista: fila de prioridades da Central.
- Consumo acima da média, concentração por turno ou área, aumento ou queda de consumo: Consumo mensal e seção "Tendências".
- Possíveis desperdícios ou perdas: alertas da Central e Relatórios.

A estrutura proposta comporta todos esses conceitos sem mudar o banco.

## 4. Roadmap (etapas independentes, nenhuma exige banco)
| # | Objetivo | Telas e arquivos | Impacto | Risco | Depende de |
|---|---|---|---|---|---|
| 1 | Base visual: cores, fonte, escala de títulos e números, estilo de status | styles.css, metrics.tsx, StockBadge | Alto | Baixo | — |
| 2 | Cabeçalho de página e barra de filtros padrão | novo PageHeader e FilterBar, todas as telas | Alto | Baixo | 1 |
| 3 | Padrão único de tabelas e de estados vazio/carregando | styles.css, telas com tabela | Alto | Baixo/médio | 1 |
| 4 | Reorganizar o menu e destacar Entregas | AppLayout.tsx | Médio | Baixo | 1 |
| 5 | Central: tendência, fila de prioridades e ações | dashboard.tsx (mesmos cálculos de use-epi-metrics) | Muito alto | Médio | 1–3 |
| 6 | Entrega no celular (busca com seleção rápida, ação fixa no rodapé) | entregas.tsx | Alto | Médio | 1–2 |
| 7 | Formulários na ordem da tarefa (seções) | epis.tsx, colaboradores.tsx | Médio | Baixo | 1 |
| 8 | Ficha do colaborador com linha do tempo | colaboradores_.$id.tsx | Médio | Baixo | 1–3 |
| 9 | Mini gráficos de tendência em EPIs, Compras e Consumo | epis, compras, consumo | Médio | Baixo | 3 |

## 5. Primeira implementação
**Etapa 1, a base visual**, em `styles.css`, `metrics.tsx` e `StockBadge.tsx`:
- Definir uma escala fixa: título de página, título de seção, número de indicador (3 tamanhos) e texto de tabela.
- Trocar a fonte (por exemplo, uma fonte técnica para números e uma fonte de texto menos genérica, carregadas no cabeçalho do site).
- Fixar as cores de status (crítico, atenção, normal, sem consumo) com o mesmo sentido em todas as telas.
- Usar números com largura fixa e alinhados em todo o sistema.

Por que começar por ela: muda a aparência de todas as telas de uma vez, mexe em 3 arquivos, não toca em regras, cálculos ou banco e prepara as etapas seguintes. Antes de escolher a fonte e as cores, mostro opções visuais para você decidir.
