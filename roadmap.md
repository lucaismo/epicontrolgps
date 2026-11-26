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
