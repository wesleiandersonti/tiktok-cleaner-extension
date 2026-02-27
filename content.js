function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isScrollable(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  const s = getComputedStyle(el);
  return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 120;
}

function getScrollableAncestor(el) {
  let cur = el;
  while (cur && cur !== document.body) {
    if (isScrollable(cur)) return cur;
    cur = cur.parentElement;
  }
  return null;
}

function getFollowingButtons(scope = document) {
  return Array.from(scope.querySelectorAll('button')).filter(b => /^(seguindo|following)$/i.test((b.textContent || '').trim()));
}

function getRowFromButton(btn) {
  const candidates = [btn.parentElement, btn.closest('li'), btn.closest('[role="listitem"]'), btn.closest('div')].filter(Boolean);
  for (const c of candidates) {
    if (c && c.querySelector('a[href*="/@"]')) return c;
  }
  return btn.parentElement || btn;
}

function findFollowingEntryRows(scope = document) {
  const rows = [];
  const seen = new Set();
  for (const btn of getFollowingButtons(scope)) {
    const row = getRowFromButton(btn);
    const link = row?.querySelector('a[href*="/@"]');
    if (!row || !link) continue;
    if (seen.has(row)) continue;
    seen.add(row);
    rows.push(row);
  }
  return rows;
}

function parseUsernameFromRow(row) {
  const a = row.querySelector('a[href*="/@"]');
  const href = a?.getAttribute('href') || '';
  const m = href.match(/\/@([a-zA-Z0-9._]+)/);
  return m ? m[1] : null;
}

function getFollowButton(row) {
  return Array.from(row.querySelectorAll('button')).find(b => /^(seguindo|following)$/i.test((b.textContent || '').trim())) || null;
}

async function ensureFollowingListOpen() {
  let dialog = document.querySelector('[role="dialog"]');
  if (dialog) return dialog;

  const clickByText = (regex) => {
    const nodes = Array.from(document.querySelectorAll('a,button,div,span'));
    const target = nodes.find(n => regex.test((n.textContent || '').trim()));
    if (target) {
      target.click();
      return true;
    }
    return false;
  };

  // 1) Perfil: contador "Seguindo"
  clickByText(/^\d+[\d.,KMBkmb]*\s*seguindo$/i);
  await sleep(900);
  dialog = document.querySelector('[role="dialog"]');
  if (dialog) return dialog;

  // 2) Clicar em qualquer item "Seguindo" no perfil
  clickByText(/^seguindo$/i);
  await sleep(900);
  dialog = document.querySelector('[role="dialog"]');
  if (dialog) return dialog;

  // 3) Sidebar Following page: botão "Ver todos"
  clickByText(/^ver todos$/i);
  await sleep(900);
  dialog = document.querySelector('[role="dialog"]');

  return dialog;
}

async function fetchProfileSignals(username) {
  const url = `https://www.tiktok.com/@${username}`;
  const resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} @${username}`);
  const html = await resp.text();

  const normalized = html.toLowerCase();

  const m = html.match(/"followerCount"\s*:\s*(\d+)/);
  const followers = m ? Number(m[1]) : null;

  // Detecção estrita para evitar falso positivo
  const hardBannedTerms = [
    "couldn't find this account",
    "não foi possível encontrar esta conta",
    "account is unavailable",
    "conta indisponível",
    "user not found",
    "usuário não encontrado"
  ];

  // Só considera banida/desativada quando NÃO existe followerCount e há termo forte
  const hasHardTerm = hardBannedTerms.some(t => normalized.includes(t));
  const isBanned = followers === null && hasHardTerm;

  return { followers, isBanned };
}

async function deepScroll(container, rounds = 25) {
  let prev = -1;
  let stuck = 0;
  for (let i = 0; i < rounds; i++) {
    container.scrollTop += Math.max(320, Math.floor(container.clientHeight * 0.8));
    await sleep(280);
    if (container.scrollTop === prev) stuck++; else stuck = 0;
    prev = container.scrollTop;
    if (stuck >= 3) break;
  }
}

async function runCleanup({ minFollowers, maxAccounts, dryRun, maxRemovals, cooldownMs, batchPauseMs, batchSize, ultraSafe, protectedUsers }) {
  const analyzeAll = !maxAccounts || Number(maxAccounts) === 0;
  const maxRemoveLimit = Math.max(1, Number(maxRemovals || 100));
  const delayBaseMs = Math.max(300, Number(cooldownMs || 1200));
  const pausePerBatchMs = Math.max(1000, Number(batchPauseMs || 8000));
  const removeBatchSize = Math.max(1, Number(batchSize || 8));
  const isUltraSafe = !!ultraSafe;
  const protectedSet = new Set((protectedUsers || []).map(x => String(x).toLowerCase()));
  const errors = [];

  const denyText = (document.body?.innerText || '').toLowerCase();
  if (denyText.includes('acesso negado') || denyText.includes('access denied')) {
    throw new Error('Acesso negado detectado na página. Pare e tente novamente mais tarde.');
  }
  const dialog = await ensureFollowingListOpen();
  if (!dialog) throw new Error('Não consegui abrir a lista de Seguindo automaticamente. Abra Perfil > Seguindo e tente novamente.');

  let rows = findFollowingEntryRows(dialog);
  if (rows.length === 0) rows = findFollowingEntryRows(document);
  if (rows.length === 0) throw new Error('Não encontrei linhas com botão "Seguindo".');

  let scrollBox = getScrollableAncestor(rows[0]) || getScrollableAncestor(dialog) || dialog;
  if (!isScrollable(scrollBox)) {
    // fallback: maior elemento rolável dentro do dialog
    const candidates = Array.from(dialog.querySelectorAll('*')).filter(isScrollable);
    candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    scrollBox = candidates[0] || scrollBox;
  }

  if (!scrollBox || !isScrollable(scrollBox)) {
    throw new Error('Lista rolável de Seguindo não encontrada.');
  }

  await deepScroll(scrollBox, 40);
  scrollBox.scrollTop = 0;
  await sleep(700);

  const checkedUsers = new Set();
  let checked = 0;
  let below = 0;
  let banned = 0;
  let removed = 0;
  let skippedProtected = 0;
  const audit = [];
  let noNewRounds = 0;

  for (let round = 0; round < 400; round++) {
    let currentRows = findFollowingEntryRows(dialog);
    if (currentRows.length === 0) currentRows = findFollowingEntryRows(document);

    let addedThisRound = 0;

    for (const row of currentRows) {
      if (!analyzeAll && checked >= maxAccounts) break;

      const username = parseUsernameFromRow(row);
      if (!username || checkedUsers.has(username)) continue;
      checkedUsers.add(username);
      addedThisRound++;

      if (protectedSet.has(username.toLowerCase())) {
        skippedProtected++;
        audit.push({ username, followers: null, isBanned: false, belowMin: false, protected: true, removed: false, reason: 'protected' });
        continue;
      }

      try {
        const signal = await fetchProfileSignals(username);
        checked++;

        const shouldRemoveByBan = signal.isBanned;
        const shouldRemoveByFollowers = signal.followers !== null && signal.followers < minFollowers;

        if (shouldRemoveByBan) banned++;
        if (shouldRemoveByFollowers) below++;

        const reason = shouldRemoveByBan && shouldRemoveByFollowers
          ? 'banned+below'
          : shouldRemoveByBan
            ? 'banned'
            : shouldRemoveByFollowers
              ? 'below'
              : '';

        let didRemove = false;
        if (shouldRemoveByBan || shouldRemoveByFollowers) {
          if (!dryRun && removed < maxRemoveLimit) {
            const btn = getFollowButton(row);
            if (btn) {
              btn.click();
              removed++;
              didRemove = true;

              const rand = isUltraSafe ? Math.floor(Math.random() * 700) : Math.floor(Math.random() * 250);
              await sleep(delayBaseMs + rand);

              if (removed % removeBatchSize === 0) {
                await sleep(pausePerBatchMs + (isUltraSafe ? 3000 : 0));
              }
            } else {
              errors.push(`botão não encontrado @${username}`);
            }
          }
        }

        audit.push({
          username,
          followers: signal.followers,
          isBanned: shouldRemoveByBan,
          belowMin: shouldRemoveByFollowers,
          protected: false,
          removed: didRemove,
          reason
        });
      } catch (e) {
        errors.push(String(e.message || e));
      }
    }

    if (!analyzeAll && checked >= maxAccounts) {
      break;
    }

    if (addedThisRound === 0) noNewRounds++; else noNewRounds = 0;
    if (noNewRounds >= 4) break;

    scrollBox.scrollTop += Math.max(220, Math.floor(scrollBox.clientHeight * 0.65));
    await sleep(320);
  }

  return { checked, below, banned, removed, skippedProtected, errors, foundTotal: checkedUsers.size, audit };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || (msg.type !== 'RUN_CLEANUP' && msg.type !== 'AUTO_TOTAL')) return;

  runCleanup(msg.payload)
    .then(sendResponse)
    .catch(err => sendResponse({ checked: 0, below: 0, removed: 0, errors: [String(err.message || err)] }));

  return true;
});
