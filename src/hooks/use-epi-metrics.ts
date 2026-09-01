import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DIA_MS, agregarConsumo, calcLeadTime, calcularLinha, CONSUMO_ZERO, type EpiCalc,
} from "@/lib/estoque-calc";

/**
 * Métricas de consumo/cobertura reaproveitando EXATAMENTE as mesmas queries do
 * módulo Compras (mesmas queryKeys => cache compartilhado, sem consulta duplicada).
 */
export function useEpiMetrics() {
  const desde = useMemo(() => new Date(Date.now() - 365 * DIA_MS).toISOString(), []);

  const { data: config } = useQuery({
    queryKey: ["compras-config"],
    queryFn: async () => (await supabase.from("compras_config").select("*").limit(1).maybeSingle()).data,
    staleTime: 5 * 60_000,
  });

  const { data: movs = [] } = useQuery({
    queryKey: ["compras-movs"],
    queryFn: async () =>
      (await supabase.from("movimentacoes")
        .select("epi_id,quantidade,tipo,data_movimentacao")
        .eq("tipo", "entrega")
        .gte("data_movimentacao", desde)
        .limit(20000)).data ?? [],
    staleTime: 60_000,
  });

  const { data: pedidos = [] } = useQuery({
    queryKey: ["compras-pedidos"],
    queryFn: async () =>
      (await supabase.from("pedidos_compra")
        .select("id,epi_id,quantidade,data_pedido,data_prevista,status")
        .order("data_pedido", { ascending: false })).data ?? [],
    staleTime: 60_000,
  });

  const lead = useMemo(
    () => calcLeadTime(config?.dia_pedido ?? 20, config?.dia_recebimento ?? 10),
    [config?.dia_pedido, config?.dia_recebimento],
  );

  const consumo = useMemo(() => agregarConsumo(movs as any[]), [movs]);

  const emTransito = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of pedidos as any[]) {
      if (p.status !== "em_aberto") continue;
      map.set(p.epi_id, (map.get(p.epi_id) ?? 0) + Number(p.quantidade ?? 0));
    }
    return map;
  }, [pedidos]);

  const metricaDe = useMemo(
    () => (epi: EpiCalc) =>
      calcularLinha(epi, consumo.get(epi.id) ?? CONSUMO_ZERO, emTransito.get(epi.id) ?? 0, lead.dias),
    [consumo, emTransito, lead.dias],
  );

  return { lead, consumo, emTransito, metricaDe, config };
}
