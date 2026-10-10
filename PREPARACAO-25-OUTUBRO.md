# PalcoLive — preparação para 25/10/2026

Produto Kiwify: `40cf8850-c44b-11f1-8fdf-3f2670dd515f`.
Preço aprovado: R$ 49,99, pagamento único, licença sem vencimento enquanto o serviço estiver disponível. Um aparelho ativado por vez.

## Preparado em 10/10/2026

- Produto e área de membros existem. Link de vendas corrigido; instruções e condições aprovadas pelo dono salvas na Kiwify.
- A integração passa a exigir KIWIFY_LICENSE_DAYS explícito; 0 significa sem vencimento. Valor ausente, vazio, negativo ou inválido deixa a integração indisponível em vez de aplicar 30 dias.
- `npm test`: 12 cenários locais passaram usando rotas Express, pedidos sintéticos e PostgreSQL WASM (PGlite). Incluem assinatura inválida, compra não paga/outro produto, validade NULL, e-mail incorreto, ativação, duplicatas, troca de aparelho, salas distintas, reembolso, aprovação atrasada, chargeback e falha de armazenamento.
- Os testes NÃO usam credenciais reais, compradores reais ou pagamentos reais. Não substituem validação de payload/assinatura enviados pela Kiwify, rede/pool PostgreSQL, concorrência com bloqueio de linhas, nem isolamento no mapa Roblox.

## Configuração planejada

```
KIWIFY_PRODUCT_ID=40cf8850-c44b-11f1-8fdf-3f2670dd515f
KIWIFY_LICENSE_DAYS=0
```

Manter LICENSE_MODE atual de teste e KIWIFY_AUTO_ENABLED sem ativação até banco, token e teste controlado estarem prontos. Não substituir SESSION_SECRET: isso invalidaria credenciais existentes e os resumos de e-mail das compras.
Após validação, a integração exige LICENSE_MODE=manual (ou hybrid), KIWIFY_AUTO_ENABLED=1, DATABASE_URL e KIWIFY_WEBHOOK_TOKEN. Nunca armazenar os segredos neste repositório.

## Pendências antes de qualquer venda

1. Escolher banco definitivo. Render Free expira em 30 dias e não oferece backups; serve apenas para ensaio temporário. Nenhum recurso pago foi autorizado nesta etapa.
2. Configurar URL interna do PostgreSQL na mesma região Virginia do servidor e token do webhook, preservando os demais segredos.
3. Conferir assinatura e dados do webhook de cursos da Kiwify. O link de documentação Notion da central de ajuda retornou 404 nesta consulta. A API bancária CASHIN/CASHOUT é outra integração e não deve substituir o webhook de pedidos.
4. Criar webhook para o produto correto e eventos de pagamento aprovado, reembolso e chargeback. Testar pela Kiwify; não usar serviços externos de captura com dados de compradores.
5. Ensaiar compra/ativação e estorno, reinício do servidor sem perda de licença, reenvio duplicado, tentativas simultâneas em aparelhos diferentes e indisponibilidade do banco.
6. Fazer duas lives com duas licenças em paralelo e confirmar isolamento real no Roblox.
7. Definir hospedagem sempre ativa e capacidade Euler/TikTok. A configuração atual do servidor Render é gratuita.
8. Confirmar elegibilidade do software junto à plataforma e revisar termos, suporte e privacidade.
9. No dia 25/10, o dono conclui a identificação com seus próprios documentos e conta bancária; aguardar aprovação. Não cadastrar documentos do responsável para trocar depois.
10. Só após aprovação e testes concluídos: retirar avisos de preparação e vincular/divulgar checkout.

## Referências

- https://render.com/docs/free
- https://ajuda.kiwify.com.br/pt-br/article/como-funcionam-os-webhooks-2ydtgl/

## Executar testes

`npm ci` e `npm test` (Node >=20). Banco efêmero em memória, sem rede externa para os testes. O adaptador de testes não reproduz concorrência de múltiplas conexões PostgreSQL.
