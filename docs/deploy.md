# Servidor gratuito

Duas opções que não expiram (pesquisadas em 31/10/2026 nas páginas dos próprios provedores). As duas já estão
configuradas no repositório; falta só a parte que exige conta, cartão ou identidade, que é sua.

| | Oracle Cloud Always Free (recomendado) | Render + Neon (alternativa) |
|---|---|---|
| Custo | grátis para sempre | grátis para sempre |
| Cartão | pede cartão e celular no cadastro (não cobra) | Neon não pede; Render não informa |
| Sempre ligado | sim (VM própria) | não: dorme após 15 min, acorda em ~1 min |
| Região | São Paulo | EUA (Virgínia) |
| Banco | Postgres + TimescaleDB no disco da VM (200 GB) | Neon, 1 GB |
| Riscos | capacidade ARM esgotada em São Paulo (tente de novo mais tarde); VM ociosa pode ser recuperada pela Oracle (passar a conta para "Pay As You Go" evita, segundo relatos, e continua grátis) | o 1 GB do Neon enche com anos de frequência cardíaca |
| Arquivos | `deploy/oracle/` | `render.yaml` |

Não use o Postgres grátis do próprio Render: ele é apagado 30 dias depois de criado.

## Opção 1 · Oracle Cloud (VM em São Paulo)

**Você:**

1. Crie a conta em [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) e escolha **São Paulo** como região
   principal. Ela não muda depois, e o grátis só vale nela.
2. Em Compute › Instances › Create: imagem **Ubuntu 24.04**, shape **VM.Standard.A1.Flex** com 2 OCPU e 12 GB.
   Cole sua chave SSH pública. Em "Advanced options › Initialization script", cole `deploy/oracle/cloud-init.yaml`.
   Se aparecer "out of host capacity", tente de novo em outro horário.
3. Na VCN da instância (Security List), libere a entrada TCP **80** e **443**.
4. Crie um nome gratuito em [duckdns.org](https://www.duckdns.org) (ex.: `knightfall-bruce.duckdns.org`) apontando
   para o IP público da VM.
5. Me passe o IP e o nome; o acesso SSH fica com a sua chave.

**Eu, daqui:**

```bash
deploy/oracle/deploy.sh ubuntu@<ip> <nome>.duckdns.org   # envia o código e sobe Postgres, API e Caddy (HTTPS)
curl https://<nome>/health               # {"status":"ok","database":"up"}
ssh ubuntu@<ip> /opt/knightfall/deploy/oracle/restore-test.sh   # prova que o backup restaura
```

No primeiro envio o script cria o `.env` na VM com uma senha do banco gerada lá mesmo (nunca passa pelo Git). O backup roda todo dia às
03:30 e guarda 14 dias em `deploy/oracle/backups/`; copie a pasta para fora da VM de vez em quando.

## Opção 2 · Render + Neon

**Você:**

1. Crie a conta no [Neon](https://neon.tech) (sem cartão) e um projeto na região **AWS US East (N. Virginia)**,
   perto do servidor do Render. Copie a connection string (`postgres://…?sslmode=require`).
2. Crie a conta no [Render](https://render.com) com o GitHub e dê acesso ao repositório `locked`.
3. New › Blueprint › escolha o repositório: o Render lê o `render.yaml` e pede o `KNIGHTFALL_DATABASE_URL`; cole a
   string do Neon.

**Eu:** confiro o `/health`, aponto o app para a URL `https://knightfall-api.onrender.com` e acompanho o primeiro
deploy. Cada push na main com mudanças em `backend/` faz um deploy novo sozinho.

## Depois, em qualquer opção

- **App:** a versão de instalação recebe a URL do servidor em `EXPO_PUBLIC_API_URL` (etapa 3 do plano).
- **Alerta de queda:** monitor gratuito do [UptimeRobot](https://uptimerobot.com) no `/health` a cada 5 minutos.
  No Render, ele também mantém o servidor acordado.
- **Senha esquecida:** o app não tem "esqueci a senha"; a redefinição é feita por mim no servidor.
