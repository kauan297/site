# PalcoLive - checklist de publicação na Kiwify

**Produto:** PalcoLive - compra única por R$ 49,99.  
**Estado:** em preparação; só divulgar após teste de compra, ativação e devolução.  
**ID do produto da conta atual:** `40cf8850-c44b-11f1-8fdf-3f2670dd515f`.

## O que já está preparado no servidor

- ID do produto: `40cf8850-c44b-11f1-8fdf-3f2670dd515f`
- Checkout específico: `https://pay.kiwify.com.br/zNBj6FP?hideCard=true` (Pix/boleto, ocultando o cartão somente nesse link).
- `KIWIFY_CHECKOUT_CODE=zNBj6FP` e `KIWIFY_CHECKOUT_URL` já configurados no Render.
- `KIWIFY_LICENSE_DAYS=0` significa licença sem data de expiração.
- `KIWIFY_AUTO_ENABLED=0` e `PUBLIC_SALES_ENABLED=0`: **não abrir vendas antes de completar os testes**.
- A página `/vendas` já contém o botão de compra, mas só aparecerá quando a ativação Kiwify responder corretamente **e** `PUBLIC_SALES_ENABLED=1`.
- Guia online do comprador: https://lunadance-server.onrender.com/app/guia.html
- A área de membros da Kiwify ainda precisa ser preenchida pelo titular via painel.

## 1. Formas de pagamento e saques

1. Kiwify > Produtos > PalcoLive > Configurações.
2. Manter Cartão, Pix e Boleto no produto (a interface atual não permite retirar cartão globalmente).
3. Desligar Apple Pay e alternativas de cartão para reduzir opções indesejadas.
4. Em **Links**, copiar o checkout exato e acrescentar **`?hideCard=true`** (ou `&hideCard=true` caso o link já tenha `?`).
5. Abrir o link definitivo em aba anônima e confirmar que só Pix e boleto são oferecidos.
6. Divulgar **exclusivamente** o link com cartão oculto. Outros links do mesmo produto ainda podem aceitar cartão.

Referência oficial: https://ajuda.kiwify.com.br/pt-br/article/como-esconder-pix-boleto-ou-cartao-no-checkout-14zb5ul/

Saques Pix e boleto são manuais. O titular da conta Kiwify é responsável pela verificação de identidade e pelos saques. Valores não são sacáveis imediatamente.

## 2. Entregar as instruções ao comprador

Kiwify > Área de Membros > área do PalcoLive > Adicionar módulo > adicionar conteúdo.

- Módulo: **Comece aqui**
- Aula: **Ative seu PalcoLive**
- Conteúdo: copiar `docs/AULA-COMECAR-AQUI.md`.
- Anexo: enviar `PalcoLive_Guia_de_Acesso_do_Cliente.pdf` fornecido separadamente.
- Publicar a aula e conferir visualização como aluno.

## 3. Preparar backend no Render

Serviço: `lunadance-server` / https://dashboard.render.com/web/srv-db1qjg9srm7s73csh1f0  
Webhook (URL pública sem token): `https://lunadance-server.onrender.com/api/kiwify/webhook`

Variáveis de ambiente obrigatórias:

| Variável | Valor/observação |
|---|---|
| `KIWIFY_PRODUCT_ID` | `40cf8850-c44b-11f1-8fdf-3f2670dd515f` (já configurada) |
| `KIWIFY_LICENSE_DAYS` | `0` (já configurada) |
| `DATABASE_URL` | URL **interna** de banco PostgreSQL durável (não enviar por chat) |
| `KIWIFY_WEBHOOK_TOKEN` | Token secreto do webhook Kiwify com pelo menos 24 caracteres. Não enviar por chat. |
| `LICENSE_MODE` | `manual` (requer `ADMIN_SECRET` com pelo menos 16 caracteres; preservar outras variáveis existentes) |
| `KIWIFY_AUTO_ENABLED` | `1` **apenas quando o restante estiver pronto para teste** |

**Atenção:** o banco gratuito `palcolive-licencas-teste` expira em 9/11/2026. Não abrir vendas com dependência permanente desse banco sem migração/upgrade autorizados. Não executar cobrança de serviço pago sem autorização.

O painel só mostrará ativação automática pronta quando as variáveis estiverem completas **e** o banco responder.

## 4. Criar webhook na Kiwify

Acesse **Apps > Webhooks > Criar webhook**.

- Nome: PalcoLive - Entrega de acesso
- Produto: PalcoLive
- URL: `https://lunadance-server.onrender.com/api/kiwify/webhook`
- Eventos: **Compra aprovada, Reembolso e Chargeback**. Para compra única, não é necessária renovação de assinatura.
- Configure o token secreto gerado na Kiwify **diretamente no Render** como `KIWIFY_WEBHOOK_TOKEN`; mantenha o token privado.
- Salve e confira logs de respostas `2xx`. Assinatura inválida retorna `401`; configuração incompleta retorna `503`.

Tutorial oficial: https://ajuda.kiwify.com.br/pt-br/article/como-funcionam-os-webhooks-2ydtgl/

## 5. Testar antes de divulgar

- Validar checkout em modo anônimo (valor, marca, Pix/Boleto).
- Confirmar que a aula do comprador está publicada.
- Testar webhook assinado e banco (não usar dados reais de cliente em testes automatizados).
- Simular compra, ativação, segundo dispositivo e reembolso em testes de desenvolvimento (cobertos por testes no repositório).
- **Ainda é obrigatório um teste ponta a ponta com a conta Kiwify real** antes da primeira venda ao público.
- Testar Roblox no PC e celular, especialmente acesso isolado por comprador.
- Liberar o botão de vendas no site só após a entrega estar validada.

## 6. Quando mudar para sua própria conta

A conta nova terá **outro ID de produto e outro webhook**. Não apague o histórico/licenças da conta antiga. Planeje também reembolsos e obrigações dos pedidos antigos. Os saldos financeiros não migram automaticamente entre contas.

## Segurança

Nunca inclua tokens, senhas, CPF ou URL interna do banco neste repositório, em imagens ou mensagens públicas. Não mostre documentos ou dados bancários em prints.
