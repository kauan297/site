# Backup privado — preparado, ainda nao instalado

O arquivo `backup.yml` deve ser copiado para `.github/workflows/backup.yml` na
branch padrao do repositorio **privado** `kauan297/palcolive-backups`. Aqui em
`docs/` ele e apenas um modelo; nao executa nem agenda backups.

O fluxo exporta uma copia AES-256-GCM, autentica o arquivo, restaura em PostgreSQL
18 descartavel e compara todas as licencas. A restauracao tem uma conexao local
fixa e nunca usa a URL de producao. O artefato criptografado e preservado mesmo
se o teste de recuperacao falhar. Nenhum segredo ou banco em claro e publicado.

Configurar, somente nos Actions secrets desse repositorio privado:

- `PALCOLIVE_BACKUP_DATABASE_URL`: conexao do banco Neon ativo das licencas.
- `SESSION_SECRET`: exatamente o segredo original do Render.
- `PALCOLIVE_BACKUP_KEY`: 32 bytes aleatorios, representados por 64 caracteres
  hexadecimais. Guardar outra copia da chave em gerenciador de senhas.

Nao copiar os valores para chat, arquivos, commits, logs ou prints. O token
Kiwify e o ADMIN_SECRET nao sao necessarios. A instalacao dos secrets e o
primeiro backup real continuam pendentes por falta de acesso administrativo.

Executar primeiro via **Actions > Backup privado das licencas > Run workflow**.
Conferir sucesso de exportacao, recuperacao e envio do artefato. O agendamento
posterior e diario as 06h UTC (03h de Brasilia); o GitHub pode atrasar ou pausar
execucoes agendadas. Manter notificacoes de falha e conferir data do ultimo backup.

Os artefatos expiram em 30 dias. Monitorar minutos e armazenamento antes de
ativar; manter cobrancas adicionais bloqueadas. Baixar regularmente uma segunda
copia criptografada para um local privado independente do GitHub. Este fluxo
sozinho nao fornece essa segunda copia nem um backup ilimitado.

O banco Render antigo ainda precisa de verificacao/exportacao por acesso interno;
nao apagar nem considerar vazio. O fluxo nao muda checkout, integracao Kiwify,
licencas ou configuracoes comerciais. Depois do backup real, continuam pendentes
evento real Kiwify, ativacao PC/celular, reembolso e revisao de lancamento.
