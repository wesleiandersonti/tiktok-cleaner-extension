# Roadmap técnico — TikTok Following Cleaner

## Concluído nesta rodada
- [x] Lock de concorrência para rotina agendada (evita overlap de execuções)
- [x] Toggle de ativação/desativação do agendamento no popup
- [x] Janela horária com regra explícita para `startHour === endHour` (24h)
- [x] Seleção de aba agendada com preferência por URL-alvo/following
- [x] Hidratação de estado do popup (último relatório + configurações)
- [x] Backoff adaptativo no `content.js` para erros de throttle/acesso negado
- [x] Validação de webhook com feedback explícito na UI
- [x] Gate de análise recente para agendamento automático
- [x] Cooldown automático pós-bloqueio para reduzir risco operacional
- [x] Limite diário absoluto de remoções
- [x] Parada de emergência com sinal de interrupção cooperativa

## Backlog priorizado (próximos issues)

### 1) Resiliência de seletor e navegação TikTok
**Objetivo:** reduzir quebra por mudanças de UI/idioma.

Critérios de aceite:
- fallback com múltiplos caminhos de abertura da lista de seguindo
- estratégia por seletor estável quando disponível + fallback textual
- cobertura mínima de PT/EN/ES para termos críticos

### 2) Gate de simulação recente para agendamento
**Objetivo:** só permitir remoção automática com análise válida recente.

Critérios de aceite:
- rotina agendada exige análise bem-sucedida dentro da janela configurável (ex.: 24h)
- quando gate bloquear, registrar motivo em `tiktokCleanerLastScheduledRun`
- UI exibe aviso claro com data da última análise válida

### 3) Testes de contrato do parser de perfil
**Objetivo:** detectar regressões quando o HTML do TikTok mudar.

Critérios de aceite:
- fixtures HTML: conta ativa, banida/indisponível, sem `followerCount`, página de bloqueio
- testes validam extração de followerCount e detecção de estado
- pipeline local de teste rápido para mudanças em heurística

### 4) Telemetria local de saúde da automação
**Objetivo:** melhorar observabilidade operacional.

Critérios de aceite:
- gravar métricas por execução: duração, throughput, taxa de erro, motivo de parada
- manter histórico rotativo (ex.: últimas 30 execuções)
- painel simples no popup com último status e tendência

### 5) Política de segurança de webhook (opcional)
**Objetivo:** reduzir risco de exfiltração por URL indevida.

Critérios de aceite:
- modo restrito com allowlist de hosts (configurável)
- bloqueio com mensagem clara quando URL estiver fora da política
- opção de operar em modo permissivo para uso local/lab
