# PalcoLive — Cakto

A Cakto envia o guia de acesso por e-mail. O comprador usa o número exibido em **Detalhes do Pedido** e seu e-mail para ativar no painel. Não há serviço adicional de envio de e-mail.

## Configuração no servidor

- `PAYMENT_PROVIDER=cakto`
- `CAKTO_AUTO_ENABLED=1`
- `CAKTO_PRODUCT_ID`: ID do produto definitivo, não o produto privado de teste.
- `CAKTO_WEBHOOK_SECRET`: segredo privado igual ao configurado na Cakto. Nunca versionar.
- `CAKTO_LICENSE_DAYS=0`: sem vencimento.
- `CAKTO_CHECKOUT_URL` e `CAKTO_CHECKOUT_CODE`: link da oferta definitiva, sem cupom ou parâmetros.
- `CAKTO_NATIVE_DELIVERY_READY=1`: somente após conferir o guia salvo e o envio real.
- `PUBLIC_SALES_ENABLED=0` até validar webhook, ativação e entrega.
- O banco existente `KIWIFY_DATABASE_URL` é reutilizado, sem trocar o `SESSION_SECRET`.

## Webhook

Destino: `https://lunadance-server.onrender.com/api/cakto/webhook`.
Eventos: `purchase_approved`, `refund`, `chargeback`. Modelo V1 e V2 são aceitos.
Validação obrigatória de `X-Cakto-Signature: v1=<HMAC-SHA256>` e `X-Cakto-Timestamp`, no corpo cru, com tolerância de cinco minutos. Por padrão, corpo sem assinatura não cria licença. A Cakto também documenta validação pelo `secret` no corpo. `CAKTO_ALLOW_LEGACY_SECRET=1` habilita esse contrato alternativo apenas em HTTPS e quando ambos os headers de assinatura estão ausentes. Header presente e inválido nunca pode cair para o método alternativo. Habilitar somente após conferir o formato efetivamente entregue pela plataforma. Um webhook da plataforma com produto diferente é ignorado.

Falhas de armazenamento retornam erro. A Cakto não reenvia automaticamente respostas HTTP de erro; acompanhar entregas e reenviar eventos que falharem pelo painel.

## Preservação

Compras antigas Kiwify e suas licenças `KWF1` continuam válidas. Novas licenças Cakto usam `CKT1` e pedidos `CAKTO_<id>` na mesma tabela protegida. A consulta de ativação separa as duas plataformas. O backup criptografado existente inclui ambas, sem armazenar CPF, endereço ou nome do comprador.

## Validação

Os testes cobrem assinatura, replay, V2, pagamento pendente, produto errado, repetição, acesso sem vencimento, e-mail errado, um aparelho por vez, transferência, reembolso, sessão revogada, compra antiga e backup. O CI usa PostgreSQL descartável para validar ativações concorrentes reais.

A compra privada de e-mail não comprova a integração do produto definitivo: manter seu checkout fechado e validar a nova ligação antes de publicar vendas.
