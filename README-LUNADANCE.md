# Luna Dance Server

Servidor central do Luna Dance.

## Importante

Nunca coloque a API Key do Roblox neste repositório.

No Render, configure as variáveis de ambiente:

- `ROBLOX_API_KEY` = sua chave secreta do Roblox
- `ROBLOX_UNIVERSE_ID` = `10769353715`
- `ROBLOX_PLACE_ID` = `76605256587436`
- `SESSION_SECRET` = uma senha aleatória longa (40+ caracteres)
- `LICENSE_MODE` = `off` para testes, depois `lemonsqueezy`
- `LEMON_PRODUCT_ID` = ID do produto no Lemon Squeezy quando ativarmos vendas
- `SESSION_HOURS` = `12`

## Render

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`

## Fluxo

1. Programa Luna Dance chama `POST /api/session/create`.
2. O servidor retorna um link do Roblox com uma sala aleatória.
3. O mapa oficial abre um servidor reservado e assina o tópico daquela sala.
4. O programa lê o chat do TikFinity.
5. Para cada nick, chama `POST /api/chat`.
6. O servidor publica no Messaging Service do Roblox.
7. Só o palco daquela sessão recebe o nick.

## Licenças

No modo `lemonsqueezy`, o servidor usa a License API do Lemon Squeezy para ativar/validar a chave. Configure o produto com limite de 1 ativação para reduzir compartilhamento.


## Ações de presentes

O endpoint `POST /api/gift` envia uma ação permanente para o avatar do nick informado.
Requer o mesmo Bearer token usado pelo chat.

Ações atuais:
- `gigante` — deixa o avatar grande e mantém a transformação.
- `gigante_dourado` — deixa o avatar maior, com dourado leve, mantendo posição e nick.
- `67medio` — deixa o avatar meio grande e ativa a dança 6-7.
- `mega_fogo` — deixa o avatar maior que os outros e em chamas, sem dourado.

Exemplo:
```json
{
  "nick": "Knzz0102",
  "action": "mega_fogo",
  "duration": 0
}
```

O app do cliente mapeia cada presente do TikFinity para uma dessas quatro ações.
