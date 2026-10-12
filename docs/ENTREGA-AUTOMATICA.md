# Entrega de ativação por e-mail

Uma compra aprovada com assinatura e produto válidos grava a licença e, quando `KIWIFY_DELIVERY_ENABLED=1`, coloca o destinatário em uma fila criptografada. O comprador recebe **PalcoLive — seu link de ativação**, com `/app/#pedido=<referência>`. O pedido é preenchido no navegador; a ativação continua exigindo o e-mail da compra e permite um aparelho de controle por vez.

O botão **RECEBER MEU LINK POR E-MAIL** permite recuperar a entrega de compras anteriores. A resposta não revela se um e-mail comprou. Nenhum pedido ou chave aparece nessa resposta. Há limite por IP/e-mail e intervalo mínimo de uma hora para reenviar uma mensagem aceita.

## Configuração pendente do remetente

O transporte implementado é a API HTTPS da Brevo. Criar e verificar a conta/remetente e aceitar os termos deve ser feito pelo titular. Usar exclusivamente o plano gratuito; não habilitar créditos pagos, upgrades ou cobrança automática. A Brevo informa 300 e-mails/dia gratuitos; conferir o limite no painel antes da ativação. O limite pode mudar e, quando esgotado, a entrega fica pendente, sem compra automática de créditos pelo PalcoLive.

No ambiente privado do Render, adicionar:

- `BREVO_API_KEY`: chave da conta do remetente, nunca em chat ou GitHub.
- `PALCOLIVE_EMAIL_FROM`: endereço de um remetente verificado na Brevo.
- `KIWIFY_DELIVERY_ENABLED=1`: somente depois de cadastrar os dois valores acima.

O servidor consulta o remetente ativo na Brevo. `/api/config` retorna `kiwifyDeliveryReady=false` quando o recurso está desligado, incompleto ou o remetente não é reconhecido. A página de vendas exige ativação de licenças **e** entrega prontas, além de `PUBLIC_SALES_ENABLED=1`. Manter essa última variável em `0` e o checkout Kiwify desativado durante o teste.

## Teste antes de vender

Usar a compra de teste já aprovada, sem novo pagamento: solicitar o link no painel, conferir a mensagem real no e-mail da compra, abrir o link e verificar o pedido preenchido. Confirmar os detalhes da fila por contagens/estado, sem imprimir destinatário, conteúdo, chave ou credenciais. Aceitação pela API de e-mail não prova que a mensagem chegou à caixa do comprador.

O CI usa PostgreSQL 18 descartável para testar ativação concorrente, liberação/troca de aparelho, reembolso, sessão revogada, webhook repetido, criptografia da fila, workers concorrentes e retomada de envio após reinício. Isso não substitui confirmar um reembolso real na Kiwify; não devolver o pagamento de teste antes de acertar essa etapa com o comprador.

## Falhas, privacidade e recuperação

Cada pedido tem uma geração UUID de envio. A mesma geração é reutilizada nas retentativas; a Brevo documenta deduplicação por 30 minutos. O envio é no máximo uma vez por geração no banco quando a resposta foi confirmada. Uma falha entre aceitação pelo provedor e confirmação no banco pode resultar em e-mail repetido após a janela de deduplicação; ele contém o mesmo pedido e não cria outra licença.

O worker processa um pedido por execução, a cada minuto enquanto o servidor está acordado e ao iniciar. Há até oito tentativas com espera crescente. A fila persiste no banco durante reinícios. O Render gratuito pode dormir: a fila volta a ser processada quando o serviço acorda, sem promessa de entrega instantânea. Após falhas esgotadas, o comprador pode solicitar reenvio após uma hora. Resolver também a causa no provedor.

O destinatário é criptografado com AES-256-GCM e uma chave derivada do `SESSION_SECRET`, com o pedido autenticado como contexto. Não trocar `SESSION_SECRET`: ele protege também licenças, e-mails e credenciais já emitidas. O destinatário é removido da fila após aceitação pelo provedor, cancelamento ou processamento de pendências com mais de 30 dias. Não imprimir resposta/corpo do provedor em logs.

Os backups existentes preservam licenças, referências, estado e aparelho; não incluem a fila de e-mail. Depois de uma recuperação, o comprador pode solicitar novamente seu link informando o e-mail original, que é comparado ao HMAC da licença recuperada.

## Banco antigo

`PALCOLIVE_LEGACY_AUDIT=1` executa uma auditoria administrativa no início do servidor usando o `DATABASE_URL` antigo. Usa uma transação somente leitura, prazo por consulta e até 50 tabelas. Registra apenas total de tabelas/linhas e necessidade de migração. Não imprime valores de clientes, nomes de tabelas ou URL. Desligar a flag após conferir o resultado. Se houver linhas, preservar o banco e preparar migração criptografada; não apagar nem presumir que são dispensáveis.

## Referências oficiais

- https://developers.brevo.com/docs/send-a-transactional-email
- https://developers.brevo.com/docs/heterogenous-versions-batch-emails
- https://developers.brevo.com/docs/getting-started-with-senders-and-domains
- https://www.brevo.com/products/transactional-email/
