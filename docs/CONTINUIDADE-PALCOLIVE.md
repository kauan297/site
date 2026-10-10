# PalcoLive — resumo de continuidade (10/10/2026)

> Documento de passagem para uma conversa nova ou ChatGPT Work. **Não contém senhas, tokens, CPF, dados bancários ou URL privada do banco.** Consulte as configurações atuais do Render/Kiwify antes de ações definitivas. Não anunciar vendas antes dos testes reais.

## Objetivo e preferências
- PalcoLive é um produto digital que conecta TikTok LIVE a um mapa próprio no Roblox. Espectadores comentam nicks Roblox e presentes provocam efeitos.
- Vender pela Kiwify por **R$ 49,99**, pagamento único, **licença sem data de expiração**. O uso depende da disponibilidade do PalcoLive, TikTok e Roblox: não prometer serviço eternamente ininterrupto.
- Funciona no PC e no celular, mediante permissões das plataformas.
- Usuário prefere **uma tarefa pequena por vez** e quer que o assistente execute autonomamente tudo o que ferramentas conectadas permitirem; mostrar o mínimo de passos manuais.
- Objetivo: lançar ainda em outubro, depois de verificar ativação, entrega e preservação das licenças. Não contratar plano ou ativar cobranças automaticamente sem autorização.

## Revisão Work em 10/10/2026 — estado atual confirmado

- Arquivo anexado, resumo completo e checklist lidos; continuação do repositório existente.
- GitHub PR #5 mesclado após todos os testes Actions passarem, incluindo PostgreSQL 18 real descartável: https://github.com/kauan297/site/pull/5
- Render implantou commit `a03793661a0a11ac06aee9375ea71ae67d96cefe`, deploy `dep-db5bsuk9v7es739060ug` confirmado live. Banco de teste disponível, expira em 09/11/2026.
- `/api/config` após deploy: `commercialReady=false`, `kiwifyAutomaticReady=false`, `salesReady=false`, checkout vazio. LICENSE_MODE não foi alterado, nenhuma integração comercial foi ligada.
- Kiwify autenticada pelo usuário com formulário seguro e verificação por e-mail. Não solicitar senhas ou códigos no chat.
- Checkout real conferido: produto correto, R$49,99, boleto/Pix. Apple Pay estava ligado e foi **desativado e salvo** nas configurações.
- **Checkout zNBj6FP foi desabilitado na Kiwify.** Link público recarregado depois da alteração mostra **Produto não está mais disponível**. Vendas bloqueadas no site e no checkout direto. Nenhuma compra realizada. Não reabilitar até banco/backup/entrega/testes reais estarem prontos.
- Área de membros vinculada ao produto: `3c4603be-4024-4c59-b472-1a1c56e7c0dd`. Aula existente foi atualizada, sem duplicá-la: módulo **Comece aqui**, aula **Ative seu PalcoLive**, publicada, liberação imediata, sem limite de duração. Guia online, ativação, celular, troca e reconexão incluídos. Prévia de aluno confirmou o texto e os links. Sem PDF anexado; não prometer anexo inexistente.
- A aula mantém aviso de lançamento em preparação. Remover esse aviso apenas quando for liberar vendas após validação.
- Webhook existente **PalcoLive - Vendas Automáticas**: produto correto, URL correta e apenas Compra aprovada, Reembolso e Chargeback selecionados. Token não foi alterado; rotação ainda necessária antes das vendas.
- Teste oficial Kiwify com dados fictícios enviado (evento padrão boleto gerado); interface confirmou envio, mas **não houve comprovação do status de recebimento/processamento**. Logs Kiwify e consulta de logs request Render não mostraram registro. Não contar como compra aprovada, assinatura validada ou teste ponta a ponta.
- Consulta Postgres pelo conector recusada por lista externa vazia; não enfraquecemos rede. A conexão interna do servidor ainda precisa ser comprovada em modo de integração.
- Backup privado AES-256-GCM e restauração transacional para destino vazio preparados em `scripts/license-backup.cjs`; preservam SESSION_SECRET, reembolsos, prazos e aparelho. Testes locais e teste PostgreSQL descartável passaram. **Backup real, armazenamento/agendamento privado e migração durável ainda não executados.**
- Documentação de recuperação: `docs/LICENCAS-BACKUP-E-MIGRACAO.md`. Nunca enviar segredos, URLs privadas ou arquivos de licenças ao repositório público.
- Candidato gratuito para banco durável: Neon Free. Documentação oficial conferida em 10/10/2026: 1 GB de Postgres/projeto, 100 CU-h/mês, 5 GB de transferência pública/mês, restauração nativa de 6h; ao esgotar computação, suspende até o próximo mês sem apagar dados. Isso exige monitoramento e backup externo; não garante serviço perpétuo/ininterrupto.
- Plugin Neon encontrado, ainda não conectado: `plugin_asdk_app_69e0086d87088191a3edc052fa50c29f`. Próxima etapa manual proposta: conectar Neon para criar/configurar exclusivamente plano gratuito. Nenhum recurso Neon criado e nenhum plano pago contratado. Conferir conexão antes de usar ferramentas.
- Próximas prioridades: banco durável + backup/restore reais; rotação segura do token; ativação em modo de teste com vendas bloqueadas; compra/ativação/reembolso reais e teste Roblox em PC/celular. Depois, remover aviso provisório e liberar venda somente com autorização de lançamento.

## Infraestrutura
- GitHub: https://github.com/kauan297/site, **branch de produção: `lunadance-server`**.
- Render Web Service: `lunadance-server`, ID `srv-db1qjg9srm7s73csh1f0`, workspace `tea-db17evou01pc73d6eu7g`.
- Painel Render: https://dashboard.render.com/web/srv-db1qjg9srm7s73csh1f0
- Site de vendas: https://lunadance-server.onrender.com/vendas
- Painel do comprador: https://lunadance-server.onrender.com/app/
- Guia do comprador: https://lunadance-server.onrender.com/app/guia.html
- Webhook do produto: `POST https://lunadance-server.onrender.com/api/kiwify/webhook`
- Backend Node + Express, `server.js`, `kiwify-auto.js`, `sales-gate.js`, `tiktok-direct.js`, arquivos públicos em `public/`.
- Render web service usa plano gratuito; pode suspender por inatividade. Servidor confirmado **live** em 10/10/2026, deploy do commit `a03793661a0a11ac06aee9375ea71ae67d96cefe` após merge do PR #5; documentação pode gerar deploy posterior.
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
- Kiwify área de membros: módulo **Comece aqui** e aula **Ative seu PalcoLive** publicados e conferidos na prévia de aluno. Liberação imediata, sem duração limitada. Guia online em `/app/guia.html`. Ainda falta acesso de comprador após compra real.
- A Kiwify está sob responsabilidade de um titular adulto autorizado; dados de saque devem ser do titular. Após mudar para conta própria, novo produto/webhook e migração sem perder licenças anteriores; não presumir migração automática.

## Testes já feitos versus não feitos
**Já realizado:**
- Testes de desenvolvimento GitHub Actions de webhook assinado, aprovações/reembolso, bloqueio de licença revogada, um dispositivo por licença, sem prazo de expiração, frontend de venda bloqueado, Roblox/PC/celular. PRs #2, #3 e #4 foram mesclados, Render implantou.
- Backend aceita tokens gerados menores preservando validação HMAC-SHA1.

**Ainda NÃO validado:**
- Evento **real** de Kiwify chegando ao Render; formato exato, assinatura e resposta 2xx; compra verdadeira e ativação ponta a ponta; emissão e recuperação de licença contra banco real; acesso de comprador real à área de membros; comportamento com reembolso real; checkout após futura reativação; segurança de banco durável e backups.
- Não assumir que salvar variáveis = concluir integração.

## Passos pendentes em ordem (uma coisa por vez)
1. Confirmar em Kiwify que webhook produto/eventos está correto e verificar segredo sem publicá-lo; rotacionar token exposto antes de venda, se possível.
2. Área de membros já preenchida/publicada e prévia conferida; testar entrega para comprador real e remover aviso de preparação somente ao lançar.
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
