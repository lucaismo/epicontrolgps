
REVOKE EXECUTE ON FUNCTION public.registrar_entrega_atomica(uuid, uuid, integer, text, timestamptz, uuid, text, uuid, integer, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finalizar_inventario(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.registrar_entrada_estoque(uuid, integer, text, text, uuid) FROM PUBLIC, anon;
