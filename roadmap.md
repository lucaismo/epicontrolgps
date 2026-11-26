# Roadmap — Fase 1 SaaS

- [x] Preparar migrations isoladas de organizações, memberships e tenant nas nove tabelas operacionais.
- [x] Implementar backfill por identidade de banco, bloqueios de transição e finalização reconciliada.
- [x] Implementar vínculo entrega/troca e RPCs com tenant e locks canônicos, preservando assinaturas.
- [x] Montar PostgreSQL local descartável e testes automatizados de segurança, concorrência, estoque e posse.
- [x] Registrar resultados, arquivos e pendências exclusivas de Supabase staging; confirmar que In-Haus não foi alterada.

## Evolução visual do Dashboard

- [x] Refinar hierarquia, indicadores, prioridades e gráficos sem mudar cálculos ou consultas.
- [x] Executar testes aplicáveis: 44 testes aprovados; compilação de módulos verificada pelo Vite e build automático aprovado às 10:05:08 UTC.
- [x] Verificar Dashboard autenticado com dados reais em desktop, notebook e mobile (conta do Lucas, sem erros).

## Estados dos indicadores do Dashboard

- [x] Substituir valores transitórios por carregamento e diferenciar falhas, sem mudar fórmulas ou consultas.
- [x] Validar carregamento, sucesso com dados reais, zero e falhas controladas em desktop (1440), notebook (1024) e celular (375); 36 testes de regressão aprovados.

## C2.3 — Etapa 1 exclusivamente local

- [x] Criar runner C2 com lista de permissões e validação de socket, porta, diretório e banco.
- [x] Conter as três RPCs críticas sem alterar regras de movimentação ou grants gerais.
- [x] Executar 20 testes locais aprovados de autorização, spoofing, contratos e triggers; registrar resultados e pendências externas em c2_corrections/RESULTS.md.

## C2.4 — Etapa 2 exclusivamente local

- [x] Restringir UPDATE de EPIs às colunas do payload existente e revogar INSERT direto em movimentações.
- [x] Comprovar compatibilidade de RPCs/triggers, privilégios efetivos, reaplicação e isolamento: 26 testes novos e regressão C2.3 aprovados.
- [x] Registrar relatório de privilégios, resultados, incompatibilidades e limitações em c2_corrections/RESULTS_C2_4.md sem alterar a operação In-Haus.
