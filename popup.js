const statusEl = document.getElementById('status');
const minFollowersEl = document.getElementById('minFollowers');
const maxAccountsEl = document.getElementById('maxAccounts');
const maxRemovalsEl = document.getElementById('maxRemovals');
const cooldownMsEl = document.getElementById('cooldownMs');
const protectedUsersEl = document.getElementById('protectedUsers');
const batchPauseMsEl = document.getElementById('batchPauseMs');
const batchSizeEl = document.getElementById('batchSize');
const profileUrlEl = document.getElementById('profileUrl');
const startHourEl = document.getElementById('startHour');
const endHourEl = document.getElementById('endHour');
const intervalMinEl = document.getElementById('intervalMin');
const webhookUrlEl = document.getElementById('webhookUrl');
const testWebhookBtn = document.getElementById('testWebhookBtn');

const dryBtn = document.getElementById('dryBtn');
const autoBtn = document.getElementById('autoBtn');
const safeBtn = document.getElementById('safeBtn');
const runBtn = document.getElementById('runBtn');
const exportBtn = document.getElementById('exportBtn');
const saveScheduleBtn = document.getElementById('saveScheduleBtn');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

let lastReport = null;
let isRunning = false;

const defaultLabels = {
  dry: dryBtn.textContent,
  auto: autoBtn.textContent,
  safe: safeBtn.textContent,
  run: runBtn.textContent,
};

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function setStatus(text) { statusEl.textContent = text; }

function setProgress(percent, label) {
  const p = Math.max(0, Math.min(100, Number(percent || 0)));
  progressBar.style.width = `${p}%`;
  progressText.textContent = label || `${p}%`;
}

function setButtonsRunning(mode = null) {
  const disabled = isRunning;
  [dryBtn, autoBtn, safeBtn, runBtn, exportBtn, saveScheduleBtn, testWebhookBtn].forEach(b => b.disabled = disabled);

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

function validateInputs() {
  const minFollowers = Number(minFollowersEl.value || 0);
  const maxAccounts = Number(maxAccountsEl.value || 0);
  const maxRemovals = Number(maxRemovalsEl.value || 100);
  const cooldownMs = Number(cooldownMsEl.value || 1200);
  const batchPauseMs = Number(batchPauseMsEl.value || 8000);
  const batchSize = Number(batchSizeEl.value || 8);
  const protectedUsers = parseProtectedUsers(protectedUsersEl.value);

  if (Number.isNaN(minFollowers) || minFollowers < 0) throw new Error('Mínimo inválido.');
  if (Number.isNaN(maxAccounts) || maxAccounts < 0) throw new Error('Máximo inválido. Use 0 para todas.');
  if (Number.isNaN(maxRemovals) || maxRemovals < 1) throw new Error('Máximo de remoções inválido.');
  if (Number.isNaN(cooldownMs) || cooldownMs < 300) throw new Error('Delay inválido (mínimo 300ms).');
  if (Number.isNaN(batchPauseMs) || batchPauseMs < 1000) throw new Error('Pausa por lote inválida (mínimo 1000ms).');
  if (Number.isNaN(batchSize) || batchSize < 1) throw new Error('Tamanho do lote inválido.');

  return { minFollowers, maxAccounts, maxRemovals, cooldownMs, batchPauseMs, batchSize, protectedUsers };
}

async function postWebhook(payload) {
  const url = (webhookUrlEl?.value || '').trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch {
    // silencioso: não interrompe fluxo principal
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
    unfollowedAccounts
  };
}

function renderReport(resp) {
  lastReport = resp;
  const report = buildExecutionReport(resp);
  const lines = [];
  lines.push(`Perfis encontrados: ${report.foundTotal}`);
  lines.push(`Analisadas: ${report.checked}`);
  lines.push(`Banidas/desativadas detectadas: ${report.banned}`);
  lines.push(`Abaixo do mínimo: ${report.below}`);
  lines.push(`Protegidas ignoradas: ${report.skippedProtected}`);
  lines.push(`Removidas: ${report.removed}`);

  if (report.unfollowedCount > 0) {
    lines.push(`Contas deixadas de seguir (${report.unfollowedCount}):`);
    for (const a of report.unfollowedAccounts.slice(0, 20)) {
      lines.push(`- @${a.username} (${a.reason})`);
    }
    if (report.unfollowedCount > 20) {
      lines.push(`- ... e mais ${report.unfollowedCount - 20}`);
    }
  }

  if (report.errors?.length) {
    lines.push('Erros:');
    for (const e of report.errors.slice(0, 8)) lines.push(`- ${e}`);
  }

  setStatus(lines.join('\n'));
  chrome.storage.local.set({ tiktokCleanerLastReport: resp, tiktokCleanerLastSummary: report });

  postWebhook({
    source: 'tiktok-cleaner-extension',
    ts: new Date().toISOString(),
    summary: report
  });
}

async function runCore({ dryRun, autoTotal = false, ultraSafe = false, skipAnalyzeGuard = false }) {
  const cfg = validateInputs();

  if (!dryRun && !skipAnalyzeGuard && !lastReport) {
    throw new Error('Execute primeiro "Só analisar" (obrigatório), depois rode remoção.');
  }

  const tab = await getActiveTab();
  if (!tab?.id || !tab.url?.includes('tiktok.com')) {
    throw new Error('Abra uma aba do TikTok para executar.');
  }

  const msg = {
    type: autoTotal ? 'AUTO_TOTAL' : 'RUN_CLEANUP',
    payload: {
      ...cfg,
      dryRun,
      autoTotal,
      ultraSafe,
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
    setProgress(100, 'Concluído');
    renderReport(resp);
  } catch (e) {
    setStatus('Erro: ' + String(e.message || e));
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
    renderReport(analyzeResp);

    setStatus('Etapa 2/2: iniciando ULTRA-SAFE automaticamente...');
    setProgress(55, 'Etapa 2/2: removendo ultra-safe');
    const ultraResp = await runCore({ dryRun: false, autoTotal: true, ultraSafe: true, skipAnalyzeGuard: true });
    setProgress(100, 'Concluído');
    renderReport(ultraResp);
  } catch (e) {
    setStatus('Erro: ' + String(e.message || e));
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
  return {
    enabled: true,
    profileUrl: (profileUrlEl.value || 'https://www.tiktok.com/following').trim(),
    startHour: Number(startHourEl.value || 2),
    endHour: Number(endHourEl.value || 6),
    intervalMin: Number(intervalMinEl.value || 20),
    minFollowers: Number(minFollowersEl.value || 100),
    maxAccounts: Number(maxAccountsEl.value || 0),
    maxRemovals: Number(maxRemovalsEl.value || 100),
    cooldownMs: Number(cooldownMsEl.value || 1200),
    batchPauseMs: Number(batchPauseMsEl.value || 8000),
    batchSize: Number(batchSizeEl.value || 8),
    protectedUsers: parseProtectedUsers(protectedUsersEl.value),
    webhookUrl: (webhookUrlEl?.value || '').trim()
  };
}

function saveSchedule() {
  const payload = buildSchedulePayload();
  chrome.runtime.sendMessage({ type: 'SCHEDULE_SAVE', payload }, (resp) => {
    if (chrome.runtime.lastError) return setStatus('Erro ao salvar agendamento: ' + chrome.runtime.lastError.message);
    if (!resp?.ok) return setStatus('Falha ao salvar agendamento.');
    setStatus(`Agendamento salvo: ${payload.startHour}:00-${payload.endHour}:00, a cada ${payload.intervalMin} min.`);
  });
}

function loadSchedule() {
  chrome.runtime.sendMessage({ type: 'SCHEDULE_GET' }, (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) return;
    const s = resp.tiktokCleanerSchedule;
    if (s) {
      profileUrlEl.value = s.profileUrl || profileUrlEl.value;
      startHourEl.value = String(s.startHour ?? 2);
      endHourEl.value = String(s.endHour ?? 6);
      intervalMinEl.value = String(s.intervalMin ?? 20);
      if (webhookUrlEl) webhookUrlEl.value = s.webhookUrl || webhookUrlEl.value;
    }
    const last = resp.tiktokCleanerLastScheduledRun;
    if (last?.at) {
      setStatus(`Última rotina automática: ${last.at}`);
    }
  });
}

dryBtn.addEventListener('click', () => runSingle(true));
autoBtn.addEventListener('click', () => runSingle(false, true));
safeBtn.addEventListener('click', runAnalyzeThenUltraSafe);
runBtn.addEventListener('click', () => runSingle(false));
exportBtn.addEventListener('click', exportCsv);
saveScheduleBtn.addEventListener('click', saveSchedule);
testWebhookBtn.addEventListener('click', async () => {
  await postWebhook({
    source: 'tiktok-cleaner-extension',
    ts: new Date().toISOString(),
    summary: { checked: 0, banned: 0, below: 0, removed: 0, note: 'teste manual de webhook' }
  });
  setStatus('Teste de envio executado. Verifique esta conversa em alguns segundos.');
});

loadSchedule();
