# PalcoLive — resumo de continuidade (10/10/2026)

> Documento de passagem para uma conversa nova ou ChatGPT Work. **Não contém senhas, tokens, CPF, dados bancários ou URL privada do banco.** Consulte as configurações atuais do Render/Kiwify antes de ações definitivas. Não anunciar vendas antes dos testes reais.

## Objetivo e preferências
- PalcoLive é um produto digital que conecta TikTok LIVE a um mapa próprio no Roblox. Espectadores comentam nicks Roblox e presentes provocam efeitos.
- Vender pela Kiwify por **R$ 49,99**, pagamento único, **licença sem data de expiração**. O uso depende da disponibilidade do PalcoLive, TikTok e Roblox: não prometer serviço eternamente ininterrupto.
- Funciona no PC e no celular, mediante permissões das plataformas.
- Usuário prefere **uma tarefa pequena por vez** e quer que o assistente execute autonomamente tudo o que ferramentas conectadas permitirem; mostrar o mínimo de passos manuais.
- Objetivo: lançar ainda em outubro, depois de verificar ativação, entrega e preservação das licenças. Não contratar plano ou ativar cobranças automaticamente sem autorização.

## Revisão Work em 10/10/2026 — continuar daqui

- Arquivo anexado e este resumo lidos completamente; repositório existente clonado, sem reiniciar o projeto.
- Render confirma deploy `672de8ae51204751cdc22ed30063ffd50163dc6d` live e banco gratuito disponível, com expiração em 09/11/2026.
- `/api/config` real retorna `commercialReady=false`, `kiwifyAutomaticReady=false`, `salesReady=false` e checkout vazio. Nada foi habilitado pelo assistente.
- **Checkout direto da Kiwify abre um formulário de pagamento:** nome do produto correto, R$49,99, boleto/Pix e também **Apple Pay**. Ocultar cartão não retirou Apple Pay. Nenhuma compra foi realizada. Bloquear o site não bloqueia o checkout direto; conferir/desativar no painel antes de continuar a preparação.
- Dashboard Kiwify redireciona a login; não há sessão autenticada neste navegador. Área de membros, eventos e bloqueio direto ainda não conferidos. Próxima etapa manual: autenticação segura na Kiwify, sem enviar senha no chat.
- Consulta Postgres pelo conector foi recusada porque a lista de acesso externo está vazia. Nenhuma regra de rede foi enfraquecida. Isso não comprova falha da conexão interna do servidor.
- Seis conjuntos de testes locais passaram (compra simulada, token curto, vendas/frontend, estabilidade e novo backup simulado).
- PR #5: https://github.com/kauan297/site/pull/5 prepara backup privado criptografado AES-256-GCM e restauração transacional para destino vazio, preservando SESSION_SECRET, aparelhos, reembolsos e prazos. Também testa PostgreSQL 18 descartável no Actions e passa a testar pushes de produção. Consultar o estado do PR/Actions antes de presumir merge ou deploy.
- Procedimento: `docs/LICENCAS-BACKUP-E-MIGRACAO.md`. **Backup real, agendamento, armazenamento privado e migração para banco durável ainda não executados.** Nenhum plano pago contratado; nenhum segredo exposto.
- Não declarar o produto pronto: faltam banco durável, backup/restore reais, checkout bloqueado durante preparação, entrega Kiwify e compra/ativação/reembolso reais.

## Infraestrutura
- GitHub: https://github.com/kauan297/site, **branch de produção: `lunadance-server`**.
- Render Web Service: `lunadance-server`, ID `srv-db1qjg9srm7s73csh1f0`, workspace `tea-db17evou01pc73d6eu7g`.
- Painel Render: https://dashboard.render.com/web/srv-db1qjg9srm7s73csh1f0
- Site de vendas: https://lunadance-server.onrender.com/vendas
- Painel do comprador: https://lunadance-server.onrender.com/app/
- Guia do comprador: https://lunadance-server.onrender.com/app/guia.html
- Webhook do produto: `POST https://lunadance-server.onrender.com/api/kiwify/webhook`
- Backend Node + Express, `server.js`, `kiwify-auto.js`, `sales-gate.js`, `tiktok-direct.js`, arquivos públicos em `public/`.
- Render web service usa plano gratuito; pode suspender por inatividade. Servidor confirmado **live** em 10/10/2026, deploy do commit `206c4f3fdca90ee06648c2cb10d36349bb0858fd`; reiniciado após o usuário salvar variáveis do banco.
- Roblox Universe `10769353715`; Place `76605256587436`. Abrir a sala **pelo painel** e não por link genérico. Há botão de reabrir o mesmo palco; desconexão de Roblox por inatividade de ~20 minutos não é evitável.
- Postgres de teste Render `palcolive-licencas-teste`, ID `dpg-db5337navr4c73f9l3mg-a`, plano **free**, estado `available`, **expira em 09/11/2026**. É banco **de testes**, sem backup adequado para licenças comerciais permanentes. Não vender dependendo dele sem plano de migração/upgrade seguro e autorizados.

## Kiwify
- Produto ID `40cf8850-c44b-11f1-8fdf-3f2670dd515f`.
- Checkout previsto: `https://pay.kiwify.com.br/zNBj6FP?hideCard=true`. O parâmetro oculta cartão nesse link; **validar em aba anônima** que só Pix/boleto aparecem. Outras URLs de compra podem continuar aceitando cartão.
- Usuário **criou** o webhook chamado `PalcoLive - Vendas Automáticas` em Apps > Webhooks, selecionou o produto e os eventos: **Compra aprovada**, **Reembolso**, **Chargeback**.
- Kiwify gerou token automaticamente; campo token é somente copiar. Usuário copiou token para a variável Render `KIWIFY_WEBHOOK_TOKEN` e salvou (confirmação relatada pelo usuário, não ler/expor segredo). Atenção: token apareceu em prints anteriores; **rotacionar se possível antes de vendas**. Em 10/10, código foi adaptado para aceitar tokens Kiwify gerados de **8 a 512 caracteres** sem reduzir checagem da assinatura HMAC-SHA1; testes GitHub concluídos.
- Usuário copiou a **Internal Database URL** do Render Postgres e colou em Render `DATABASE_URL`, sem divulgar o segredo; confirmou salvar e deploy **live**. **Conectividade real do banco ainda não foi comprovada pela integração comercial**, pois `LICENSE_MODE` continua em modo teste, `KIWIFY_AUTO_ENABLED=0`.
- Variáveis já preparadas: `KIWIFY_PRODUCT_ID`, `KIWIFY_LICENSE_DAYS=0`, `KIWIFY_CHECKOUT_CODE=zNBj6FP`, `KIWIFY_CHECKOUT_URL=https://pay.kiwify.com.br/zNBj6FP?hideCard=true`; verificar antes de alterar.
- **Não mudar inadvertidamente** `PUBLIC_SALES_ENABLED=0` nem `KIWIFY_AUTO_ENABLED=0`: venda permanece indisponível até integração testada. Para modo comercial é necessário verificar `LICENSE_MODE=manual` e o `ADMIN_SECRET` existente de 16+ caracteres; nunca destruir variáveis de ambientes existentes.
- O botão da página de vendas aparece apenas quando `PUBLIC_SALES_ENABLED=1`, `kiwifyAutomaticReady` confirma conexão, e checkout seguro corresponde ao domínio Kiwify esperado.
- Kiwify área de membros: ainda não foi concluída/confirmada. Criar módulo **Comece aqui**, aula **Ative seu PalcoLive**, conteúdo pronto em `docs/AULA-COMECAR-AQUI.md`; guia online em `/app/guia.html`. Testar como cliente.
- A Kiwify está sob responsabilidade de um titular adulto autorizado; dados de saque devem ser do titular. Após mudar para conta própria, novo produto/webhook e migração sem perder licenças anteriores; não presumir migração automática.

## Testes já feitos versus não feitos
**Já realizado:**
- Testes de desenvolvimento GitHub Actions de webhook assinado, aprovações/reembolso, bloqueio de licença revogada, um dispositivo por licença, sem prazo de expiração, frontend de venda bloqueado, Roblox/PC/celular. PRs #2, #3 e #4 foram mesclados, Render implantou.
- Backend aceita tokens gerados menores preservando validação HMAC-SHA1.

**Ainda NÃO validado:**
- Evento **real** de Kiwify chegando ao Render; formato exato, assinatura e resposta 2xx; compra verdadeira e ativação ponta a ponta; emissão e recuperação de licença contra banco real; área de membros publicada; comportamento com reembolso real; detalhes do checkout incognito; segurança de banco durável e backups.
- Não assumir que salvar variáveis = concluir integração.

## Passos pendentes em ordem (uma coisa por vez)
1. Confirmar em Kiwify que webhook produto/eventos está correto e verificar segredo sem publicá-lo; rotacionar token exposto antes de venda, se possível.
2. Preencher Kiwify **Área de membros** com aula do arquivo `docs/AULA-COMECAR-AQUI.md` e link do guia; simular acesso.
3. Validar em Kiwify checkout **R$49,99** e Pix/boleto sem cartão no link esperado.
4. Definir estratégia de banco durável + backup/restore antes da primeira venda, observando expiração em 09/11/2026; não assumir que 3 dias antes do vencimento é seguro. Nunca contratar plano pago sem consentimento.
5. Com ambiente de teste seguro, preparar `LICENSE_MODE=manual` e integrar Kiwify, incluindo teste real de assinatura, criação/ativação, segundo dispositivo, reembolso, reconexão e armazenamento. Fazer migração/backup se trocar banco.
6. Somente após testes concluídos e banco assegurado: ativar `KIWIFY_AUTO_ENABLED=1`, verificar `/api/config` mostra `kiwifyAutomaticReady=true`, então `PUBLIC_SALES_ENABLED=1`; divulgar vendas.
7. Confirmar contato de suporte, termos de uso e política de privacidade, instruções e políticas da Kiwify.
8. Priorizar segurança do dinheiro: não inferir que fundos serão liberados imediatamente. Titular deve validar conta/saques.

## Referências do repositório
- `docs/KIWIFY-CHECKLIST-PUBLICACAO.md`: etapas técnicas completas e ressalvas de segurança.
- `docs/AULA-COMECAR-AQUI.md`: texto da aula para o comprador.
- `tests/kiwify-auto.test.cjs`, `tests/kiwify-short-token.test.cjs`, `tests/sales-gate.test.cjs`, `tests/sales-frontend.test.cjs`.
- GitHub Actions workflows em `.github/workflows/`.

## Instrução ao próximo assistente/Work
**Continuar do ponto atual, não reiniciar o projeto.** Primeiro consultar este arquivo e o repositório na branch `lunadance-server`, depois verificar estado real de GitHub, Render e Kiwify. Fazer a maior quantidade de trabalho possível sozinho e perguntar uma etapa manual por vez, com orientação visual. Não revelar nem solicitar que o usuário envie tokens, Internal Database URL, senhas, documentos, CPF ou dados bancários no chat. Nenhuma assinatura/compra/saque/alteração irreversível sem autorização explícita; nunca abrir vendas com banco temporário e integração ainda não testada. Se Work exigir novo chat, anexar o arquivo de continuidade.
