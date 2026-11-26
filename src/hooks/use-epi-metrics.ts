import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DIA_MS, agregarConsumo, calcLeadTime, calcularLinha, CONSUMO_ZERO, type EpiCalc,
} from "@/lib/estoque-calc";
import { fetchEntregasDesde } from "@/lib/consumo";

/**
 * Métricas de consumo/cobertura reaproveitando EXATAMENTE as mesmas queries do
 * módulo Compras (mesmas queryKeys => cache compartilhado, sem consulta duplicada).
 */
export function useEpiMetrics(reportQueryErrors = false) {
  const desde = useMemo(() => new Date(Date.now() - 365 * DIA_MS).toISOString(), []);

  const { data: config, isLoading: carregandoConfigInicial, isFetching: carregandoConfig, isError: erroConfig } = useQuery({
    queryKey: ["compras-config"],
    queryFn: async () => {
      const result = await supabase.from("compras_config").select("*").limit(1).maybeSingle();
      if (reportQueryErrors && result.error) throw result.error;
      return result.data;
    },
    staleTime: 5 * 60_000,
  });

  const { data: movs = [], isLoading: carregandoMovs, isFetching: consultandoMovs, isError: erroMovs } = useQuery({
    queryKey: ["compras-movs"],
    queryFn: () => fetchEntregasDesde(desde),
    staleTime: 60_000,
  });

  const { data: pedidos = [], isLoading: carregandoPedidosInicial, isFetching: carregandoPedidos, isError: erroPedidos } = useQuery({
    queryKey: ["compras-pedidos"],
    queryFn: async () => {
      const result = await supabase.from("pedidos_compra")
        .select("id,epi_id,quantidade,data_pedido,data_prevista,status")
        .order("data_pedido", { ascending: false });
      if (reportQueryErrors && result.error) throw result.error;
      return result.data ?? [];
    },
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

  return { lead, consumo, emTransito, metricaDe, config, pedidos, entregas365: movs, carregandoMovs, erroMovs,
    consultandoMovs, carregandoConfig, erroConfig, carregandoPedidos, erroPedidos,
    carregandoConfigInicial, carregandoPedidosInicial };
}
