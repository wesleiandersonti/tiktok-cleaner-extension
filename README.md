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
   - delay por remoção (ms)
   - lista protegida (@ nunca remover)
4. Fluxo recomendado:
   - **1) Só analisar** (obrigatório)
   - **2) AUTO TOTAL** (remoção)
5. Opcional: **Exportar relatório CSV**.
6. Para rotina automática, preencha a seção de agendamento e clique em **Salvar agendamento automático**.
   - Exemplo: 02:00–06:00, a cada 20 minutos.

## Como funciona
- tenta abrir a lista de "Seguindo"
- varre a lista com rolagem profunda
- para cada @usuário, consulta `https://www.tiktok.com/@usuario`
- detecta conta banida/desativada/suspensa (PT/EN)
- extrai `followerCount`
- remove automaticamente:
  - contas banidas/desativadas/suspensas
  - contas com seguidores abaixo do mínimo
