const statusEl = document.getElementById('status');
const minFollowersEl = document.getElementById('minFollowers');
const maxAccountsEl = document.getElementById('maxAccounts');
const maxRemovalsEl = document.getElementById('maxRemovals');
const cooldownMsEl = document.getElementById('cooldownMs');
const dailyRemovalCapEl = document.getElementById('dailyRemovalCap');
const protectedUsersEl = document.getElementById('protectedUsers');
const batchPauseMsEl = document.getElementById('batchPauseMs');
const batchSizeEl = document.getElementById('batchSize');
const profileUrlEl = document.getElementById('profileUrl');
const scheduleEnabledEl = document.getElementById('scheduleEnabled');
const requireRecentAnalyzeEl = document.getElementById('requireRecentAnalyze');
const startHourEl = document.getElementById('startHour');
const endHourEl = document.getElementById('endHour');
const intervalMinEl = document.getElementById('intervalMin');
const analysisMaxAgeHoursEl = document.getElementById('analysisMaxAgeHours');
const cooldownAfterBlockHoursEl = document.getElementById('cooldownAfterBlockHours');
const webhookUrlEl = document.getElementById('webhookUrl');
const testWebhookBtn = document.getElementById('testWebhookBtn');

const dryBtn = document.getElementById('dryBtn');
const autoBtn = document.getElementById('autoBtn');
const safeBtn = document.getElementById('safeBtn');
const runBtn = document.getElementById('runBtn');
const exportBtn = document.getElementById('exportBtn');
const saveScheduleBtn = document.getElementById('saveScheduleBtn');
const emergencyStopBtn = document.getElementById('emergencyStopBtn');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

const UI_CONFIG_KEY = 'tiktokCleanerUiConfig';
const LOCAL_WEBHOOK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const DAILY_REMOVALS_KEY = 'tiktokCleanerDailyRemovalStats';
const STOP_REQUEST_KEY = 'tiktokCleanerStopRequested';

let lastReport = null;
let isRunning = false;
let persistUiTimer = null;

const defaultLabels = {
  dry: dryBtn.textContent,
  auto: autoBtn.textContent,
  safe: safeBtn.textContent,
  run: runBtn.textContent
};

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function setStatus(text) {
  statusEl.textContent = text;
}

function appendStatusLine(line) {
  const current = statusEl.textContent || '';
  statusEl.textContent = current ? `${current}\n${line}` : line;
}

function setProgress(percent, label) {
  const p = Math.max(0, Math.min(100, Number(percent || 0)));
  progressBar.style.width = `${p}%`;
  progressText.textContent = label || `${p}%`;
}

function setButtonsRunning(mode = null) {
  const disabled = isRunning;
  [dryBtn, autoBtn, safeBtn, runBtn, exportBtn, saveScheduleBtn, testWebhookBtn].forEach(b => {
    b.disabled = disabled;
  });

  dryBtn.textContent = defaultLabels.dry;
  autoBtn.textContent = defaultLabels.auto;
  safeBtn.textContent = defaultLabels.safe;
  runBtn.textContent = defaultLabels.run;

  if (disabled && mode === 'dry') dryBtn.textContent = 'Executando análise...';
  if (disabled && mode === 'auto') autoBtn.textContent = 'Executando...';
  if (disabled && mode === 'safe') safeBtn.textContent = 'Executando ULTRA-SAFE...';
  if (disabled && mode === 'manual') runBtn.textContent = 'Executando manual...';

  if (!disabled) setProgress(0, 'Pronto para executar');
}

function parseProtectedUsers(raw) {
  return (raw || '')
    .split(',')
    .map(x => x.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
}

function parseWebhookUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return { ok: true, url: '' };

  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, error: 'Webhook deve usar http:// ou https://.' };
    }

    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol === 'http:' && !LOCAL_WEBHOOK_HOSTS.has(host)) {
      return { ok: false, error: 'Webhook remoto precisa usar https:// (http:// apenas localhost).' };
    }

    parsed.hash = '';
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: 'URL de webhook inválida.' };
  }
}

function validateInputs() {
  const minFollowers = Number(minFollowersEl.value || 0);
  const maxAccounts = Number(maxAccountsEl.value || 0);
  const maxRemovals = Number(maxRemovalsEl.value || 100);
  const cooldownMs = Number(cooldownMsEl.value || 1200);
  const batchPauseMs = Number(batchPauseMsEl.value || 8000);
  const batchSize = Number(batchSizeEl.value || 8);
  const dailyRemovalCap = Number(dailyRemovalCapEl.value || 200);
  const protectedUsers = parseProtectedUsers(protectedUsersEl.value);

  if (Number.isNaN(minFollowers) || minFollowers < 0) throw new Error('Mínimo inválido.');
  if (Number.isNaN(maxAccounts) || maxAccounts < 0) throw new Error('Máximo inválido. Use 0 para todas.');
  if (Number.isNaN(maxRemovals) || maxRemovals < 1) throw new Error('Máximo de remoções inválido.');
  if (Number.isNaN(cooldownMs) || cooldownMs < 300) throw new Error('Delay inválido (mínimo 300ms).');
  if (Number.isNaN(batchPauseMs) || batchPauseMs < 1000) throw new Error('Pausa por lote inválida (mínimo 1000ms).');
  if (Number.isNaN(batchSize) || batchSize < 1) throw new Error('Tamanho do lote inválido.');
  if (Number.isNaN(dailyRemovalCap) || dailyRemovalCap < 0) throw new Error('Limite diário inválido.');

  return { minFollowers, maxAccounts, maxRemovals, cooldownMs, batchPauseMs, batchSize, dailyRemovalCap, protectedUsers };
}

function getLocalDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function getDailyRemovalStats() {
  const today = getLocalDateKey();
  const raw = (await chrome.storage.local.get(DAILY_REMOVALS_KEY))?.[DAILY_REMOVALS_KEY];
  if (!raw || raw.date !== today) return { date: today, removed: 0 };
  const removed = Math.max(0, Number(raw.removed || 0));
  return { date: today, removed: Number.isFinite(removed) ? removed : 0 };
}

async function getDailyRemaining(dailyRemovalCap) {
  if (!dailyRemovalCap || dailyRemovalCap <= 0) {
    return { unlimited: true, remaining: Number.POSITIVE_INFINITY };
  }

  const stats = await getDailyRemovalStats();
  return {
    unlimited: false,
    remaining: Math.max(0, dailyRemovalCap - stats.removed)
  };
}

async function consumeDailyRemovals(removedCount) {
  const delta = Math.max(0, Number(removedCount || 0));
  if (!Number.isFinite(delta) || delta <= 0) return;
  const stats = await getDailyRemovalStats();
  await chrome.storage.local.set({
    [DAILY_REMOVALS_KEY]: {
      date: stats.date,
      removed: stats.removed + delta
    }
  });
}

function buildUiConfigPayload() {
  return {
    minFollowers: minFollowersEl.value,
    maxAccounts: maxAccountsEl.value,
    maxRemovals: maxRemovalsEl.value,
    cooldownMs: cooldownMsEl.value,
    dailyRemovalCap: dailyRemovalCapEl.value,
    batchPauseMs: batchPauseMsEl.value,
    batchSize: batchSizeEl.value,
    protectedUsers: protectedUsersEl.value,
    profileUrl: profileUrlEl.value,
    scheduleEnabled: !!scheduleEnabledEl.checked,
    requireRecentAnalyze: !!requireRecentAnalyzeEl.checked,
    startHour: startHourEl.value,
    endHour: endHourEl.value,
    intervalMin: intervalMinEl.value,
    analysisMaxAgeHours: analysisMaxAgeHoursEl.value,
    cooldownAfterBlockHours: cooldownAfterBlockHoursEl.value,
    webhookUrl: webhookUrlEl.value
  };
}

function applyUiConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  if (cfg.minFollowers != null) minFollowersEl.value = String(cfg.minFollowers);
  if (cfg.maxAccounts != null) maxAccountsEl.value = String(cfg.maxAccounts);
  if (cfg.maxRemovals != null) maxRemovalsEl.value = String(cfg.maxRemovals);
  if (cfg.cooldownMs != null) cooldownMsEl.value = String(cfg.cooldownMs);
  if (cfg.dailyRemovalCap != null) dailyRemovalCapEl.value = String(cfg.dailyRemovalCap);
  if (cfg.batchPauseMs != null) batchPauseMsEl.value = String(cfg.batchPauseMs);
  if (cfg.batchSize != null) batchSizeEl.value = String(cfg.batchSize);
  if (cfg.protectedUsers != null) protectedUsersEl.value = String(cfg.protectedUsers);
  if (cfg.profileUrl != null) profileUrlEl.value = String(cfg.profileUrl);
  if (typeof cfg.scheduleEnabled === 'boolean') scheduleEnabledEl.checked = cfg.scheduleEnabled;
  if (typeof cfg.requireRecentAnalyze === 'boolean') requireRecentAnalyzeEl.checked = cfg.requireRecentAnalyze;
  if (cfg.startHour != null) startHourEl.value = String(cfg.startHour);
  if (cfg.endHour != null) endHourEl.value = String(cfg.endHour);
  if (cfg.intervalMin != null) intervalMinEl.value = String(cfg.intervalMin);
  if (cfg.analysisMaxAgeHours != null) analysisMaxAgeHoursEl.value = String(cfg.analysisMaxAgeHours);
  if (cfg.cooldownAfterBlockHours != null) cooldownAfterBlockHoursEl.value = String(cfg.cooldownAfterBlockHours);
  if (cfg.webhookUrl != null) webhookUrlEl.value = String(cfg.webhookUrl);
}

function applyScheduleConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  scheduleEnabledEl.checked = !!cfg.enabled;
  if (cfg.profileUrl != null) profileUrlEl.value = String(cfg.profileUrl);
  if (cfg.startHour != null) startHourEl.value = String(cfg.startHour);
  if (cfg.endHour != null) endHourEl.value = String(cfg.endHour);
  if (cfg.intervalMin != null) intervalMinEl.value = String(cfg.intervalMin);
  if (cfg.minFollowers != null) minFollowersEl.value = String(cfg.minFollowers);
  if (cfg.maxAccounts != null) maxAccountsEl.value = String(cfg.maxAccounts);
  if (cfg.maxRemovals != null) maxRemovalsEl.value = String(cfg.maxRemovals);
  if (cfg.cooldownMs != null) cooldownMsEl.value = String(cfg.cooldownMs);
  if (cfg.dailyRemovalCap != null) dailyRemovalCapEl.value = String(cfg.dailyRemovalCap);
  if (cfg.batchPauseMs != null) batchPauseMsEl.value = String(cfg.batchPauseMs);
  if (cfg.batchSize != null) batchSizeEl.value = String(cfg.batchSize);
  if (typeof cfg.requireRecentAnalyze === 'boolean') requireRecentAnalyzeEl.checked = cfg.requireRecentAnalyze;
  if (cfg.analysisMaxAgeHours != null) analysisMaxAgeHoursEl.value = String(cfg.analysisMaxAgeHours);
  if (cfg.cooldownAfterBlockHours != null) cooldownAfterBlockHoursEl.value = String(cfg.cooldownAfterBlockHours);
  if (Array.isArray(cfg.protectedUsers)) {
    protectedUsersEl.value = cfg.protectedUsers.map(x => `@${String(x).replace(/^@/, '')}`).join(',');
  }
  if (cfg.webhookUrl != null) webhookUrlEl.value = String(cfg.webhookUrl);
}

function persistUiConfig() {
  chrome.storage.local.set({ [UI_CONFIG_KEY]: buildUiConfigPayload() });
}

function schedulePersistUiConfig() {
  clearTimeout(persistUiTimer);
  persistUiTimer = setTimeout(() => {
    persistUiConfig();
  }, 220);
}

async function postWebhook(payload) {
  const parsed = parseWebhookUrl(webhookUrlEl?.value || '');
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (!parsed.url) return { ok: true, skipped: true };

  try {
    const resp = await fetch(parsed.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) return { ok: false, error: `Webhook HTTP ${resp.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function buildExecutionReport(resp) {
  const audit = Array.isArray(resp?.audit) ? resp.audit : [];
  const unfollowedAccounts = audit
    .filter(a => a?.removed)
    .map(a => ({
      username: a.username || '',
      followers: a.followers ?? null,
      reason: a.reason || 'unknown'
    }));

  return {
    foundTotal: resp?.foundTotal ?? resp?.checked ?? 0,
    checked: resp?.checked ?? 0,
    banned: resp?.banned ?? 0,
    below: resp?.below ?? 0,
    removed: resp?.removed ?? 0,
    skippedProtected: resp?.skippedProtected ?? 0,
    errors: (resp?.errors || []).slice(0, 10),
    unfollowedCount: unfollowedAccounts.length,
    unfollowedAccounts,
    heuristicsVersion: resp?.heuristicsVersion || null,
    stoppedReason: resp?.stoppedReason || null
  };
}

function buildStatusLines(report) {
  const lines = [];
  lines.push(`Perfis encontrados: ${report.foundTotal}`);
  lines.push(`Analisadas: ${report.checked}`);
  lines.push(`Banidas/desativadas detectadas: ${report.banned}`);
  lines.push(`Abaixo do mínimo: ${report.below}`);
  lines.push(`Protegidas ignoradas: ${report.skippedProtected}`);
  lines.push(`Removidas: ${report.removed}`);

  if (report.stoppedReason) {
    lines.push(`Execução interrompida por: ${report.stoppedReason}`);
  }

  if (report.unfollowedCount > 0) {
    lines.push(`Contas deixadas de seguir (${report.unfollowedCount}):`);
    for (const a of report.unfollowedAccounts.slice(0, 20)) {
      lines.push(`- @${a.username} (${a.reason})`);
    }
    if (report.unfollowedCount > 20) {
      lines.push(`- ... e mais ${report.unfollowedCount - 20}`);
    }
  }

  if (report.heuristicsVersion) {
    lines.push(`Heurística ativa: ${report.heuristicsVersion}`);
  }

  if (report.errors?.length) {
    lines.push('Erros:');
    for (const e of report.errors.slice(0, 8)) lines.push(`- ${e}`);
  }

  return lines;
}

function renderReport(resp, options = {}) {
  const { persist = true, notifyWebhook = true, runMeta = null } = options;
  lastReport = resp;

  const report = buildExecutionReport(resp);
  setStatus(buildStatusLines(report).join('\n'));

  if (persist) {
    const payload = { tiktokCleanerLastReport: resp, tiktokCleanerLastSummary: report };
    if (runMeta?.dryRun) {
      payload.tiktokCleanerLastAnalyzeRun = {
        at: new Date().toISOString(),
        summary: report,
        source: runMeta.source || 'popup'
      };
    }
    chrome.storage.local.set(payload);
  }

  if (notifyWebhook) {
    postWebhook({
      source: 'tiktok-cleaner-extension',
      ts: new Date().toISOString(),
      summary: report
    }).then(result => {
      if (result?.ok || result?.skipped) return;
      appendStatusLine(`Aviso webhook: ${result.error}`);
    });
  }
}

function renderStoredSummary(summary, lastRunAt) {
  const report = buildExecutionReport(summary);
  const lines = buildStatusLines(report);
  if (lastRunAt) lines.push(`Última rotina automática: ${lastRunAt}`);
  setStatus(lines.join('\n'));
}

async function runCore({ dryRun, autoTotal = false, ultraSafe = false, skipAnalyzeGuard = false }) {
  const cfg = validateInputs();
  persistUiConfig();

  await chrome.storage.local.set({ [STOP_REQUEST_KEY]: false });

  if (!dryRun && !skipAnalyzeGuard && !lastReport) {
    throw new Error('Execute primeiro "Só analisar" (obrigatório), depois rode remoção.');
  }

  let effectiveMaxRemovals = cfg.maxRemovals;
  if (!dryRun) {
    const daily = await getDailyRemaining(cfg.dailyRemovalCap);
    if (!daily.unlimited && daily.remaining <= 0) {
      throw new Error('Limite diário absoluto de remoções atingido. Tente novamente amanhã ou aumente o limite.');
    }
    if (!daily.unlimited) {
      effectiveMaxRemovals = Math.max(1, Math.min(cfg.maxRemovals, daily.remaining));
    }
  }

  const tab = await getActiveTab();
  if (!tab?.id || !tab.url?.includes('tiktok.com')) {
    throw new Error('Abra uma aba do TikTok para executar.');
  }

  const msg = {
    type: autoTotal ? 'AUTO_TOTAL' : 'RUN_CLEANUP',
    payload: {
      ...cfg,
      maxRemovals: effectiveMaxRemovals,
      dryRun,
      autoTotal,
      ultraSafe,
      stopKey: STOP_REQUEST_KEY
    }
  };

  const sendMessage = () => new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, msg, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!resp) return reject(new Error('Sem resposta do content script.'));
      resolve(resp);
    });
  });

  try {
    return await sendMessage();
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    return await sendMessage();
  }
}

async function runSingle(dryRun, autoTotal = false, ultraSafe = false) {
  if (isRunning) return;
  isRunning = true;
  setButtonsRunning(dryRun ? 'dry' : ultraSafe ? 'safe' : autoTotal ? 'auto' : 'manual');

  try {
    setStatus('Executando... aguarde.');
    setProgress(20, 'Iniciando...');
    const resp = await runCore({ dryRun, autoTotal, ultraSafe });
    if (!dryRun) await consumeDailyRemovals(resp?.removed || 0);
    setProgress(100, 'Concluído');
    renderReport(resp, {
      runMeta: {
        source: 'popup',
        dryRun,
        autoTotal: !!autoTotal,
        ultraSafe: !!ultraSafe
      }
    });
  } catch (e) {
    setStatus('Erro: ' + String(e?.message || e));
  } finally {
    isRunning = false;
    setButtonsRunning(null);
  }
}

async function runAnalyzeThenUltraSafe() {
  if (isRunning) return;
  isRunning = true;
  setButtonsRunning('safe');

  try {
    setStatus('Etapa 1/2: análise obrigatória...');
    setProgress(15, 'Etapa 1/2: analisando');
    const analyzeResp = await runCore({ dryRun: true, autoTotal: false, ultraSafe: false, skipAnalyzeGuard: true });
    renderReport(analyzeResp, {
      runMeta: { source: 'popup-safe-step1', dryRun: true, autoTotal: false, ultraSafe: false }
    });

    setStatus('Etapa 2/2: iniciando ULTRA-SAFE automaticamente...');
    setProgress(55, 'Etapa 2/2: removendo ultra-safe');
    const ultraResp = await runCore({ dryRun: false, autoTotal: true, ultraSafe: true, skipAnalyzeGuard: true });
    await consumeDailyRemovals(ultraResp?.removed || 0);
    setProgress(100, 'Concluído');
    renderReport(ultraResp, {
      runMeta: { source: 'popup-safe-step2', dryRun: false, autoTotal: true, ultraSafe: true }
    });
  } catch (e) {
    setStatus('Erro: ' + String(e?.message || e));
  } finally {
    isRunning = false;
    setButtonsRunning(null);
  }
}

function exportCsv() {
  if (!lastReport || !Array.isArray(lastReport.audit) || lastReport.audit.length === 0) {
    setStatus('Sem relatório para exportar. Rode uma análise primeiro.');
    return;
  }

  const header = ['username', 'followers', 'isBanned', 'belowMin', 'protected', 'removed', 'reason'];
  const rows = lastReport.audit.map(a => [
    a.username || '',
    a.followers ?? '',
    a.isBanned ? '1' : '0',
    a.belowMin ? '1' : '0',
    a.protected ? '1' : '0',
    a.removed ? '1' : '0',
    (a.reason || '').replace(/,/g, ';')
  ]);

  const csv = [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tiktok-cleaner-report-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function buildSchedulePayload() {
  const parsedWebhook = parseWebhookUrl(webhookUrlEl?.value || '');
  if (!parsedWebhook.ok) throw new Error(parsedWebhook.error);

  return {
    enabled: !!scheduleEnabledEl.checked,
    profileUrl: (profileUrlEl.value || 'https://www.tiktok.com/following').trim(),
    startHour: Number(startHourEl.value || 2),
    endHour: Number(endHourEl.value || 6),
    intervalMin: Number(intervalMinEl.value || 20),
    requireRecentAnalyze: !!requireRecentAnalyzeEl.checked,
    analysisMaxAgeHours: Number(analysisMaxAgeHoursEl.value || 24),
    cooldownAfterBlockHours: Number(cooldownAfterBlockHoursEl.value || 12),
    minFollowers: Number(minFollowersEl.value || 100),
    maxAccounts: Number(maxAccountsEl.value || 0),
    maxRemovals: Number(maxRemovalsEl.value || 100),
    dailyRemovalCap: Number(dailyRemovalCapEl.value || 200),
    cooldownMs: Number(cooldownMsEl.value || 1200),
    batchPauseMs: Number(batchPauseMsEl.value || 8000),
    batchSize: Number(batchSizeEl.value || 8),
    protectedUsers: parseProtectedUsers(protectedUsersEl.value),
    webhookUrl: parsedWebhook.url
  };
}

function saveSchedule() {
  let payload;
  try {
    payload = buildSchedulePayload();
  } catch (e) {
    setStatus('Erro ao validar agendamento: ' + String(e?.message || e));
    return;
  }

  persistUiConfig();
  chrome.runtime.sendMessage({ type: 'SCHEDULE_SAVE', payload }, (resp) => {
    if (chrome.runtime.lastError) {
      return setStatus('Erro ao salvar agendamento: ' + chrome.runtime.lastError.message);
    }
    if (!resp?.ok) {
      return setStatus('Falha ao salvar agendamento: ' + (resp?.error || 'erro desconhecido.'));
    }

    if (!payload.enabled) {
      return setStatus('Agendamento automático desativado.');
    }

    setStatus(`Agendamento ativo: ${payload.startHour}:00-${payload.endHour}:00, a cada ${payload.intervalMin} min.`);
  });
}

function runEmergencyStop() {
  chrome.runtime.sendMessage({ type: 'EMERGENCY_STOP' }, (resp) => {
    if (chrome.runtime.lastError) {
      return setStatus('Falha na parada de emergência: ' + chrome.runtime.lastError.message);
    }
    if (!resp?.ok) {
      return setStatus('Falha na parada de emergência: ' + (resp?.error || 'erro desconhecido.'));
    }

    scheduleEnabledEl.checked = false;
    persistUiConfig();
    setStatus('Parada de emergência acionada. Agendamento desativado e cancelamento solicitado para execuções ativas.');
  });
}

function loadState() {
  chrome.storage.local.get(
    [
      'tiktokCleanerSchedule',
      'tiktokCleanerLastScheduledRun',
      'tiktokCleanerLastReport',
      'tiktokCleanerLastSummary',
      'tiktokCleanerLastAnalyzeRun',
      'tiktokCleanerCooldownUntil',
      UI_CONFIG_KEY
    ],
    (data) => {
      const uiCfg = data?.[UI_CONFIG_KEY];
      if (uiCfg) applyUiConfig(uiCfg);

      if (data?.tiktokCleanerSchedule) {
        if (!uiCfg) {
          applyScheduleConfig(data.tiktokCleanerSchedule);
        } else if (typeof data.tiktokCleanerSchedule.enabled === 'boolean') {
          scheduleEnabledEl.checked = data.tiktokCleanerSchedule.enabled;
        }
      }

      const storedReport = data?.tiktokCleanerLastReport;
      const cooldownUntil = Number(data?.tiktokCleanerCooldownUntil || 0);
      const hasCooldown = Number.isFinite(cooldownUntil) && cooldownUntil > Date.now();
      const cooldownLine = hasCooldown
        ? `Cooldown ativo até: ${new Date(cooldownUntil).toISOString()}`
        : null;

      if (storedReport && typeof storedReport === 'object') {
        renderReport(storedReport, { persist: false, notifyWebhook: false });
        if (cooldownLine) appendStatusLine(cooldownLine);
        return;
      }

      if (data?.tiktokCleanerLastSummary) {
        renderStoredSummary(data.tiktokCleanerLastSummary, data?.tiktokCleanerLastScheduledRun?.at || null);
        if (cooldownLine) appendStatusLine(cooldownLine);
        return;
      }

      const lastRunAt = data?.tiktokCleanerLastScheduledRun?.at;
      if (lastRunAt) {
        setStatus(`Última rotina automática: ${lastRunAt}`);
        if (cooldownLine) appendStatusLine(cooldownLine);
        return;
      }

      if (cooldownLine) setStatus(cooldownLine);
    }
  );
}

dryBtn.addEventListener('click', () => runSingle(true));
autoBtn.addEventListener('click', () => runSingle(false, true));
safeBtn.addEventListener('click', runAnalyzeThenUltraSafe);
runBtn.addEventListener('click', () => runSingle(false));
exportBtn.addEventListener('click', exportCsv);
saveScheduleBtn.addEventListener('click', saveSchedule);
emergencyStopBtn.addEventListener('click', runEmergencyStop);
testWebhookBtn.addEventListener('click', async () => {
  const result = await postWebhook({
    source: 'tiktok-cleaner-extension',
    ts: new Date().toISOString(),
    summary: { checked: 0, banned: 0, below: 0, removed: 0, note: 'teste manual de webhook' }
  });

  if (result?.ok) {
    setStatus('Teste de envio concluído com sucesso.');
  } else if (result?.skipped) {
    setStatus('Webhook vazio. Preencha uma URL para testar envio.');
  } else {
    setStatus('Falha no webhook: ' + result.error);
  }
});

[
  minFollowersEl,
  maxAccountsEl,
  maxRemovalsEl,
  cooldownMsEl,
  dailyRemovalCapEl,
  protectedUsersEl,
  batchPauseMsEl,
  batchSizeEl,
  profileUrlEl,
  scheduleEnabledEl,
  requireRecentAnalyzeEl,
  startHourEl,
  endHourEl,
  intervalMinEl,
  analysisMaxAgeHoursEl,
  cooldownAfterBlockHoursEl,
  webhookUrlEl
].forEach(el => {
  if (!el) return;
  el.addEventListener('input', schedulePersistUiConfig);
  el.addEventListener('change', schedulePersistUiConfig);
});

loadState();
