# Fase 1 — infraestrutura multiempresa em staging

## Objetivo
Preparar a migração SaaS sem aplicar qualquer alteração no banco conectado da In-Haus e sem mudar o fluxo atual do aplicativo.

## Implementação
1. Criar scripts versionados fora das pastas de migrations aplicadas automaticamente, com organizações, memberships, controle de onboarding/backfill e `organization_id` inicialmente anulável nas nove tabelas operacionais.
2. Adicionar constraints, FKs compostas e vínculo explícito e exclusivo entre entrega e troca; manter o histórico sem inferir vínculos antigos por timestamp ou texto.
3. Implementar transição protegida: worker identificado por `session_user`, lotes limitados, inserts atribuídos somente ao tenant autenticado, updates cruzados bloqueados e finalização que exige reconciliação completa antes de `NOT NULL` e remoção dos triggers temporários.
4. Preservar as assinaturas das RPCs e adaptar entrega múltipla/atômica, edição e exclusão ao tenant, ao vínculo explícito e à ordem canônica de locks: colaborador, EPIs ordenados, movimentações.
5. Criar um ambiente PostgreSQL local descartável, reproduzir o schema pelas migrations existentes e executar testes de RLS, backfill, concorrência, estoque, posse, edição/exclusão e limpeza dos triggers.

## Limites
- Nenhuma migration será enviada ao banco In-Haus.
- Nenhuma organização fictícia será criada no banco conectado.
- A liberação de uma segunda organização permanecerá desativada após a fase 1.
- Mudanças de frontend e de tipos gerados ficam fora desta etapa, pois dependem da aplicação validada em staging.

## Entrega
Scripts completos, suíte repetível, resultados dos testes e lista explícita do que ainda exige Supabase staging independente.
