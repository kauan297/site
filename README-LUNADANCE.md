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
