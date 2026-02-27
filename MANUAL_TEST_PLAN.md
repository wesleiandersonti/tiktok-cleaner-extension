# Plano de teste manual

## Pré-requisitos
- Chrome/Edge com perfil de teste logado no TikTok
- Extensão recarregada em `chrome://extensions`
- Aba do TikTok aberta em `https://www.tiktok.com/following`

## Bloco 1 - Smoke do popup e persistência
1. Abra o popup.
2. Altere: `minFollowers`, `maxAccounts`, `dailyRemovalCap`, `scheduleEnabled`, `webhookUrl`.
3. Feche e abra o popup.

Esperado:
- valores alterados permanecem
- status inicial carrega sem erro

## Bloco 2 - Webhook e validação
1. Em webhook, teste URL inválida (ex.: `ftp://teste`).
2. Clique em salvar agendamento.
3. Ajuste para `http://127.0.0.1:8788/report` e teste envio.

Esperado:
- URL inválida mostra erro explícito
- URL local aceita
- botão de teste informa sucesso/falha com mensagem clara

## Bloco 3 - Agendamento e lock
1. Ative agendamento e salve (intervalo curto de teste, ex.: 5 min).
2. Force uma execução longa manual (`ULTRA-SAFE`) e, durante execução, aguarde alarme.
3. Após término, verifique `chrome.storage.local`.

Esperado:
- não inicia segunda execução simultânea
- `tiktokCleanerLastScheduledRun.reason === "already_running"` quando houver colisão
- lock é removido ao final (`tiktokCleanerRunLock` não persiste indefinidamente)

## Bloco 4 - Gate de análise recente (agendado)
1. Marque `Exigir análise recente antes de remover`.
2. Limpe/ausente `tiktokCleanerLastAnalyzeRun` no storage e aguarde alarme.

Esperado:
- rotina agendada não remove
- `tiktokCleanerLastScheduledRun.skipped === true`
- motivo de bloqueio: `no_recent_analysis` (ou `analysis_too_old`)

## Bloco 5 - Backoff e motivo de parada
1. Rode análise em cenário com erro de acesso/rate limit (se ocorrer naturalmente).
2. Verifique status final no popup.

Esperado:
- mensagens de erro incluem backoff
- em acesso negado/captcha, execução para imediato com `stoppedReason: access_denied`
- relatório mostra `heuristicsVersion`

## Bloco 6 - Limite diário absoluto
1. Configure `dailyRemovalCap` baixo (ex.: 1).
2. Execute remoção que consuma o limite.
3. Tente nova remoção no mesmo dia.

Esperado:
- segunda tentativa é bloqueada por limite diário
- storage mostra consumo em `tiktokCleanerDailyRemovalStats`

## Bloco 7 - Parada de emergência
1. Inicie uma execução longa.
2. Clique em `Parada de emergência` no popup.

Esperado:
- agendamento é desativado
- execução ativa para com `stoppedReason: emergency_stop` (em até alguns segundos)
- `tiktokCleanerStopRequested === true` após acionamento

## Janela horária
1. Defina `startHour == endHour`.
2. Salve agendamento.

Esperado:
- rotina considera janela de 24h
