# TikTok Following Cleaner (Extensão Chrome)

Extensão privada para varrer sua lista de **Seguindo** e remover contas abaixo de um mínimo de seguidores.

## Avisos
- Use somente na sua conta.
- TikTok muda interface com frequência; ajustes podem ser necessários.
- Execute com cuidado (evite volumes muito altos por rodada).

## Instalação
1. Abra `chrome://extensions`
2. Ative **Modo do desenvolvedor**
3. Clique em **Carregar sem compactação**
4. Selecione a pasta `tiktok-cleaner-extension`

## Uso
1. Abra o TikTok logado e vá para seu **Perfil**.
2. Clique na extensão.
3. Defina:
   - mínimo de seguidores da conta (ex.: 100)
   - máximo de contas por execução (0 = todas)
   - máximo de remoções por rodada (segurança)
   - limite diário absoluto de remoções (0 = sem limite)
   - delay por remoção (ms)
   - lista protegida (@ nunca remover)
4. Fluxo recomendado:
   - **1) Só analisar** (obrigatório)
   - **2) AUTO TOTAL** (remoção)
5. Opcional: **Exportar relatório CSV**.
6. Para rotina automática, preencha a seção de agendamento e clique em **Salvar agendamento automático**.
   - Exemplo: 02:00–06:00, a cada 20 minutos.
   - Você pode ativar/desativar a rotina pelo checkbox **Ativar rotina automática**.
   - Se início e fim forem iguais, a janela é tratada como 24h.
   - Opcional: exigir análise recente antes da remoção automática.
   - Opcional: definir cooldown automático após bloqueio/captcha.
   - Opcional: usar **Parada de emergência** para desativar agendamento e solicitar interrupção de execução ativa.

## Webhook
- O campo webhook é opcional.
- URLs remotas devem usar `https://`.
- `http://` é aceito apenas para ambiente local (`localhost`/`127.0.0.1`).

## Roadmap
- Consulte `ROADMAP.md` para backlog técnico e critérios de aceite.

## Como funciona
- tenta abrir a lista de "Seguindo"
- varre a lista com rolagem profunda
- para cada @usuário, consulta `https://www.tiktok.com/@usuario`
- detecta conta banida/desativada/suspensa (PT/EN)
- extrai `followerCount`
- remove automaticamente:
  - contas banidas/desativadas/suspensas
  - contas com seguidores abaixo do mínimo
- inclui backoff adaptativo e interrupção por bloqueio/captcha
- aplica lock de concorrência no agendamento
