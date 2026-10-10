# Preservação das licenças PalcoLive

Vendas continuam bloqueadas. O banco Render de testes expira em 09/11/2026.
Backup é uma cópia de segurança, não substitui um banco ativo durável nem comprova entrega Kiwify.

## O que está preparado

`scripts/license-backup.cjs` exporta pedidos, estados de reembolso, aparelhos e prazos numa transação consistente.
O arquivo usa AES-256-GCM: alterações ou uma chave incorreta impedem a recuperação.
O `SESSION_SECRET` original fica dentro do arquivo criptografado: ele é essencial para os resumos de e-mail,
licenças e credenciais já emitidas continuarem válidos após migração. Nunca trocar esse segredo como parte da migração.
O arquivo não inclui a URL do banco, token Kiwify, ADMIN_SECRET, CPF ou e-mails em claro.

A restauração usa uma única transação, bloqueia a tabela e exige destino vazio e o mesmo SESSION_SECRET.
Não sobrescreve pedidos existentes, nem reativa compras reembolsadas. Nenhuma rota de backup é exposta no site.
Os testes locais usam banco simulado; o GitHub Actions também executa um teste em PostgreSQL 18 descartável.
Isso não é um teste do banco de produção nem um teste real de compra Kiwify.

## Configuração privada necessária

Executar num ambiente administrativo seguro com Node e dependências do projeto instaladas.
Configurar as variáveis pelo gerenciador privado do ambiente; não copiar valores para chat, commits, prints ou comandos públicos.

- Conexão: `PALCOLIVE_BACKUP_DATABASE_URL` (destino/origem explícitos de uma operação administrativa), depois `KIWIFY_DATABASE_URL` (banco ativo das licenças), depois `DATABASE_URL` (compatibilidade). Configurar a variável correta para a operação; as URLs continuam privadas.
- `SESSION_SECRET`: manter exatamente o segredo atual do Render.
- `PALCOLIVE_BACKUP_KEY`: chave aleatória de 32 bytes codificada em 64 caracteres hexadecimais, guardada num gerenciador de senhas.
- `PGSSLMODE=require`: quando o fornecedor exigir TLS; a validação do certificado permanece ativa.
- Para restaurar: `PUBLIC_SALES_ENABLED=0` e `KIWIFY_AUTO_ENABLED=0` explicitamente.

Não é necessário gerar uma nova chave a cada backup. Perder a chave impede recuperar o backup.
Não guardar a chave junto com o arquivo. O arquivo contém segredos criptografados e continua sendo privado.

## Exportação e verificação

```bash
node scripts/license-backup.cjs export backups/licencas-2026-10-10.palcolive.enc
node scripts/license-backup.cjs verify backups/licencas-2026-10-10.palcolive.enc
```

Criar antes a pasta privada `backups/`. O comando exige nome novo e não sobrescreve arquivos.
Guardar cópias fora do Render em dois locais privados independentes. Não usar repositório público ou artefatos públicos de Actions.
Verificar autenticação do arquivo e fazer restauração periódica num banco isolado.
O comando `verify` confirma integridade e leitura, mas não comprova restauração no banco.
Depois das vendas: exportar diariamente e antes de mudanças no banco; definir monitoramento das falhas e retenção antes do lançamento.
Não existe agendamento instalado ainda. Backups diários podem perder pedidos/aparelhos alterados desde a última cópia;
reconciliar eventos Kiwify após incidente antes de liberar o serviço.

## Migração sem perder acesso

1. Escolher e configurar banco PostgreSQL sem expiração de teste, com plano e limites conferidos. Não contratar sem autorização.
2. Fechar site e checkout direto na Kiwify durante a janela de migração; manter webhooks antigos para reenvio/reconciliação.
3. Desligar processamento Kiwify no servidor, aguardar requisições em curso terminarem e exportar a cópia final.
4. Restaurar num destino vazio com o SESSION_SECRET original:

   ```bash
   node scripts/license-backup.cjs restore backups/licencas-2026-10-10.palcolive.enc
   ```

5. Conferir contagens e estados, reembolso, prazo nulo e ativação com credencial existente no ambiente isolado.
6. Atualizar KIWIFY_DATABASE_URL e opções TLS no Render, preservando DATABASE_URL antiga e os demais segredos. O backend usa KIWIFY_DATABASE_URL quando definida, com DATABASE_URL como fallback.
7. Habilitar a integração para teste, mantendo PUBLIC_SALES_ENABLED=0; reenviar eventos Kiwify que chegaram durante a janela e reconciliar pedidos.
8. Validar compra/aparelho/reembolso reais; só depois publicar checkout e página de vendas.
9. Conservar o banco antigo e a cópia até conferir todos os dados. Não apagar o banco antigo automaticamente.

Não ativar vendas apenas por `kiwifyAutomaticReady=true`: esse campo verifica conexão, não durabilidade, backup ou entrega real.
O bloqueio do site não desativa o checkout direto da Kiwify. O titular precisa confirmar a indisponibilidade do checkout no painel.

## Pendências reais

- Kiwify acessada: aula publicada e prévia conferida; webhook com produto/URL/eventos corretos.
- Checkout R$49,99 conferido; Apple Pay desativado e checkout bloqueado no painel e link público. Manter vendas fechadas; testar entrega a comprador real.
- Escolher/configurar banco durável e armazenamento privado dos backups.
- Executar backup e restauração contra bancos reais autorizados, preservar segredos e testar credencial existente.
- Validar evento real Kiwify e reembolso, inclusive reenvio após indisponibilidade.
- Confirmar rotação do token exposto, suporte e instruções definitivas.

Candidato gratuito preparado: projeto Neon `palcolive-licencas`, ID `raspy-meadow-62372613`, organização Kauan confirmada no plano free. Branch production `br-purple-firefly-b8plpt7t`, Postgres 18 em aws-us-east-1. Tabela criada sem pedidos e consultada com sucesso. Conexão privada preparada no Render em KIWIFY_DATABASE_URL, com TLS e sem apagar DATABASE_URL antiga. A integração permanece desativada; teste Render→Neon, backup externo/agendamento e compra real ainda pendentes.
Fonte oficial consultada em 10/10/2026: https://github.com/neondatabase/website/blob/main/content/faqs/free-plan-limits-and-quotas.md
