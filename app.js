(function () {
  const STORAGE_KEY = "habits-tracker-heatmaps";
  const SYNC_TOKEN_KEY = "habits-tracker-sync-token";
  const GIST_ID_KEY = "habits-tracker-gist-id";
  const SYNC_LAST_PUSH_KEY = "habits-tracker-sync-last-push";
  const SYNC_LAST_SNAPSHOT_KEY = "habits-tracker-sync-last-snapshot";
  const THEME_KEY = "habits-tracker-theme";
  const GIST_FILENAME = "habits-tracker.json";
  const GIST_API = "https://api.github.com/gists";
  const WEEKS = 53;
  const DAYS_PER_WEEK = 7;
  const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
  const CELL_PX = 16;
  const GAP_PX = 5;
  const COLOR_PRESETS = ["#216e39", "#0969da", "#bf8700", "#8250df", "#cf222e"];

  let heatmaps = [];
  let lastSyncedSnapshot = null;
  let syncInProgress = false;
  let selectedTag = "";
  let autoPushTimer = null;
  const AUTO_PUSH_DELAY_MS = 3000;
  const SYNC_PULL_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟，避免 100 次/小时 限额
  let syncPullIntervalId = null;
  let syncPullRateLimitTimeoutId = null;
  let lastSyncErrorMessage = null;

  function startSyncPullInterval() {
    if (syncPullIntervalId) clearInterval(syncPullIntervalId);
    if (syncPullRateLimitTimeoutId) clearTimeout(syncPullRateLimitTimeoutId);
    syncPullIntervalId = null;
    syncPullRateLimitTimeoutId = null;
    if (!getSyncToken() || !getGistId()) return;
    syncPullIntervalId = setInterval(function () {
      if (!getSyncToken() || !getGistId() || syncInProgress) return;
      pullFromGist({ skipDirtyCheck: true });
    }, SYNC_PULL_INTERVAL_MS);
  }

  function pauseSyncPullUntilReset(resetTimestampSec) {
    if (syncPullIntervalId) {
      clearInterval(syncPullIntervalId);
      syncPullIntervalId = null;
    }
    if (syncPullRateLimitTimeoutId) clearTimeout(syncPullRateLimitTimeoutId);
    const resetMs = resetTimestampSec * 1000 - Date.now();
    if (resetMs <= 0) {
      startSyncPullInterval();
      return;
    }
    syncPullRateLimitTimeoutId = setTimeout(function () {
      syncPullRateLimitTimeoutId = null;
      startSyncPullInterval();
    }, Math.min(resetMs + 5000, 60 * 60 * 1000)); // 最多等 1 小时
  }

  function formatRateLimitHint(res) {
    const limit = res.headers.get("X-RateLimit-Limit");
    const remaining = res.headers.get("X-RateLimit-Remaining");
    const resetSec = res.headers.get("X-RateLimit-Reset");
    let hint = "";
    if (limit) {
      hint = "（限额 " + limit + "/小时，剩余 " + (remaining !== null && remaining !== "" ? remaining : "0") + "）";
      if (limit === "60") hint += " 未认证时仅 60 次/小时，请确认已保存 Token";
    }
    if (resetSec) {
      const resetDate = new Date(parseInt(resetSec, 10) * 1000);
      const mins = Math.round((resetDate - new Date()) / 60000);
      hint += "。请于 " + resetDate.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) + " 后重试" + (mins > 0 ? "（约 " + mins + " 分钟）" : "");
    }
    return hint;
  }

  const $ = (id) => document.getElementById(id);
  const mainPlaceholder = $("mainPlaceholder");
  const heatmapCards = $("heatmapCards");

  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) heatmaps = JSON.parse(raw);
      else heatmaps = [];
      if (!Array.isArray(heatmaps)) heatmaps = [];
      heatmaps.forEach((h) => {
        if (h.collapsed == null) h.collapsed = false;
        if (!Array.isArray(h.tags)) h.tags = [];
        if (h.trendExpanded == null) h.trendExpanded = false;
      });
    } catch (_) {
      heatmaps = [];
    }
    lastSyncedSnapshot = localStorage.getItem(SYNC_LAST_SNAPSHOT_KEY);
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(heatmaps));
    updateSyncStatusText();
    scheduleAutoPush();
    console.log("[日迹 sync] save() 已调用");
  }

  function scheduleAutoPush() {
    if (autoPushTimer) clearTimeout(autoPushTimer);
    const token = getSyncToken();
    if (!token) {
      console.log("[日迹 sync] scheduleAutoPush 跳过：未保存 Token（请在云同步中保存）");
      return;
    }
    console.log("[日迹 sync] scheduleAutoPush 已安排，约 3 秒后推送");
    autoPushTimer = setTimeout(function () {
      autoPushTimer = null;
      pushToGist();
    }, AUTO_PUSH_DELAY_MS);
  }

  function isDirty() {
    const current = JSON.stringify(heatmaps);
    return lastSyncedSnapshot != null && current !== lastSyncedSnapshot;
  }

  function updateSyncStatusText() {
    const el = $("syncStatusText");
    if (!el) return;
    if (lastSyncErrorMessage) {
      el.textContent = lastSyncErrorMessage;
      el.classList.add("sync-dirty");
      return;
    }
    const lastPush = localStorage.getItem(SYNC_LAST_PUSH_KEY);
    if (lastPush) {
      const t = parseInt(lastPush, 10);
      const date = new Date(t);
      const str = date.toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      el.textContent = isDirty() ? "未同步更改 · 上次 " + str : "上次同步 " + str;
      el.classList.toggle("sync-dirty", isDirty());
    } else {
      if (isDirty() && !getSyncToken()) {
        el.textContent = "未同步（请打开「云同步」保存 Token）";
      } else {
        el.textContent = isDirty() ? "未同步更改" : "";
      }
      el.classList.toggle("sync-dirty", isDirty());
    }
  }

  function getHeatmapIndex(id) {
    return heatmaps.findIndex((h) => h.id === id);
  }

  function getHeatmap(id) {
    return heatmaps.find((h) => h.id === id);
  }

  /** 返回该周周一 0 点（周从周一开始） */
  function getWeekStart(d) {
    const day = d.getDay();
    const daysFromMonday = (day + 6) % 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - daysFromMonday);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  function getGridDates(viewRange) {
    const range = viewRange === undefined || viewRange === "recent" ? "recent" : Number(viewRange);
    let weekStart;
    let yearStart, yearEnd;

    if (range === "recent") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      weekStart = getWeekStart(today);
    } else {
      weekStart = getWeekStart(new Date(range, 0, 1));
      yearStart = new Date(range, 0, 1);
      yearStart.setHours(0, 0, 0, 0);
      yearEnd = new Date(range, 11, 31);
      yearEnd.setHours(23, 59, 59, 999);
    }

    const dates = [];
    for (let col = 0; col < WEEKS; col++) {
      const weekOffset = range === "recent" ? (WEEKS - 1 - col) * DAYS_PER_WEEK : 0;
      for (let row = 0; row < DAYS_PER_WEEK; row++) {
        const d = new Date(weekStart);
        if (range === "recent") d.setDate(weekStart.getDate() - weekOffset + row);
        else d.setDate(weekStart.getDate() + col * DAYS_PER_WEEK + row);
        const inYear = range === "recent" || (d >= yearStart && d <= yearEnd);
        dates.push({ date: d, col, row, inYear });
      }
    }
    return dates;
  }

  function formatDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  /** 统计当前时间范围内的总次数、最长连续天数、日均次数（按唯一日期统计，避免同一日重复计入） */
  function getHeatmapStats(heatmap, viewRange) {
    const gridDates = getGridDates(viewRange);
    const rangeDates = viewRange === "recent" ? gridDates : gridDates.filter((x) => x.inYear);
    const uniqueKeys = new Set();
    rangeDates.forEach(({ date }) => uniqueKeys.add(formatDateKey(date)));
    const daysInRange = uniqueKeys.size;
    let total = 0;
    const keysWithRecord = [];
    uniqueKeys.forEach((key) => {
      const c = heatmap.data[key] || 0;
      total += c;
      if (c >= 1) keysWithRecord.push(key);
    });
    keysWithRecord.sort();
    let streakDays = 0;
    if (keysWithRecord.length) {
      let run = 1;
      for (let i = 1; i < keysWithRecord.length; i++) {
        const prev = new Date(keysWithRecord[i - 1]);
        const curr = new Date(keysWithRecord[i]);
        prev.setHours(0, 0, 0, 0);
        curr.setHours(0, 0, 0, 0);
        const diffDays = Math.round((curr - prev) / (24 * 60 * 60 * 1000));
        if (diffDays === 1) run++;
        else {
          if (run > streakDays) streakDays = run;
          run = 1;
        }
      }
      if (run > streakDays) streakDays = run;
    }
    const avgPerDay = daysInRange ? total / daysInRange : 0;
    return { total, streakDays, daysInRange, avgPerDay };
  }

  /** 当前时间范围内每月总次数，用于趋势图 */
  function getTrendDataByMonth(heatmap, viewRange) {
    const range = viewRange === undefined || viewRange === "recent" ? "recent" : Number(viewRange);
    const result = [];
    if (range === "recent") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      for (let i = 11; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth();
        const next = new Date(y, m + 1, 0);
        let total = 0;
        for (let day = 1; day <= next.getDate(); day++) {
          const key = formatDateKey(new Date(y, m, day));
          total += heatmap.data[key] || 0;
        }
        result.push({ label: (m + 1) + "月", total });
      }
    } else {
      const year = range;
      for (let m = 0; m < 12; m++) {
        const next = new Date(year, m + 1, 0);
        let total = 0;
        for (let day = 1; day <= next.getDate(); day++) {
          const key = formatDateKey(new Date(year, m, day));
          total += heatmap.data[key] || 0;
        }
        result.push({ label: (m + 1) + "月", total });
      }
    }
    return result;
  }

  function getLevel(count) {
    if (!count || count <= 0) return 0;
    if (count <= 1) return 1;
    if (count <= 2) return 2;
    if (count <= 3) return 3;
    return 4;
  }

  function getLevelColors(hex) {
    const empty = "#ebedf0";
    const levels = [empty];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      levels.push(
        "rgb(" +
          Math.round(r * t + 235 * (1 - t)) +
          "," +
          Math.round(g * t + 237 * (1 - t)) +
          "," +
          Math.round(b * t + 240 * (1 - t)) +
          ")"
      );
    }
    return levels;
  }

  function createHeatmap(name = "未命名兴趣", color = "#216e39") {
    return {
      id: uuid(),
      name,
      color,
      viewRange: new Date().getFullYear(),
      data: {},
      collapsed: false,
      tags: [],
      trendExpanded: false,
    };
  }

  function getYearOptions(extendMinYear) {
    const currentYear = new Date().getFullYear();
    const minYear = extendMinYear != null && extendMinYear < currentYear - 10 ? extendMinYear : currentYear - 10;
    const years = [];
    for (let y = currentYear; y >= minYear; y--) years.push(y);
    return years;
  }

  function escapeHtml(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
  }
  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
  }

  function buildLegendHTML(colors) {
    return [0, 1, 2, 3, 4]
      .map(
        (i) =>
          `<span style="background: ${colors[i]}; border: ${i === 0 ? "1px solid var(--border)" : "none"};"></span>`
      )
      .join("");
  }

  function buildMonthLabels(gridDates, viewRange) {
    const monthStarts = [];
    let lastMonth = -1;
    const isYearView = typeof viewRange === "number";
    for (let col = 0; col < WEEKS; col++) {
      let month;
      if (isYearView) {
        const datesInCol = gridDates.filter((x) => x.col === col && x.inYear).map((x) => x.date);
        if (datesInCol.length === 0) continue;
        const earliest = new Date(Math.min(...datesInCol.map((d) => d.getTime())));
        month = earliest.getMonth();
      } else {
        month = gridDates[col * DAYS_PER_WEEK].date.getMonth();
      }
      if (col === 0 || month !== lastMonth) {
        monthStarts.push({ col, label: (month + 1) + "月", month });
        lastMonth = month;
      }
    }
    return monthStarts
      .map(
        ({ col, label, month }) => {
          const quarterClass = month !== undefined && month % 3 === 0 ? " month-quarter" : "";
          return `<span class="heatmap-month-label${quarterClass}" style="left: ${col * (CELL_PX + GAP_PX)}px">${escapeHtml(label)}</span>`;
        }
      )
      .join("");
  }

  let tooltipEl = null;
  let tooltipTargetCell = null;
  function showTooltip(e, key, getCount) {
    if (!tooltipEl) {
      tooltipEl = document.createElement("div");
      tooltipEl.className = "tooltip hidden";
      document.body.appendChild(tooltipEl);
    }
    tooltipTargetCell = e.target;
    const count = typeof getCount === "function" ? getCount() : getCount;
    tooltipEl.textContent = `${key} · ${count} 次`;
    tooltipEl.classList.remove("hidden");
    const gap = 12;
    let left = e.clientX + gap;
    let top = e.clientY;
    requestAnimationFrame(() => {
      const w = tooltipEl.offsetWidth;
      const h = tooltipEl.offsetHeight;
      if (left + w > window.innerWidth - 8) left = e.clientX - gap - w;
      if (left < 8) left = 8;
      if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
      if (top < 8) top = 8;
      tooltipEl.style.left = left + "px";
      tooltipEl.style.top = top + "px";
    });
    tooltipEl.style.left = left + "px";
    tooltipEl.style.top = top + "px";
  }
  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.add("hidden");
    tooltipTargetCell = null;
  }
  function refreshTooltipForCell(cell) {
    if (!tooltipEl || tooltipTargetCell !== cell || tooltipEl.classList.contains("hidden")) return;
    tooltipEl.textContent = `${cell.dataset.key} · ${cell.dataset.count} 次`;
  }

  function scrollHeatmapToToday(gridWrap, grid, todayKey, gridDates) {
    const idx = gridDates.findIndex((d) => formatDateKey(d.date) === todayKey);
    if (idx === -1) return;
    const isNarrow = window.matchMedia("(max-width: 768px)").matches;
    if (!isNarrow) return;
    requestAnimationFrame(() => {
      if (gridWrap.scrollWidth <= gridWrap.clientWidth) return;
      const cell = grid.children[idx];
      if (!cell) return;
      const scrollLeft = cell.offsetLeft - gridWrap.clientWidth / 2 + cell.offsetWidth / 2;
      gridWrap.scrollLeft = Math.max(0, Math.min(scrollLeft, gridWrap.scrollWidth - gridWrap.clientWidth));
    });
  }

  let cellMenuEl = null;
  let cellMenuClose = null;
  let suppressNextCellClick = null;
  let cellLongPressTimer = null;
  function showCellMenu(e, cell, currentCount, onDecrease, onClear) {
    if (cellMenuEl) {
      cellMenuEl.remove();
      if (cellMenuClose) cellMenuClose();
    }
    cellMenuEl = document.createElement("div");
    cellMenuEl.className = "cell-menu";
    const btnDecrease = document.createElement("button");
    btnDecrease.type = "button";
    btnDecrease.className = "cell-menu-btn";
    btnDecrease.textContent = "减少一次";
    btnDecrease.disabled = currentCount <= 0;
    const btnClear = document.createElement("button");
    btnClear.type = "button";
    btnClear.className = "cell-menu-btn";
    btnClear.textContent = "清零";
    btnClear.disabled = currentCount <= 0;
    btnDecrease.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onDecrease();
      hideCellMenu();
    });
    btnClear.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onClear();
      hideCellMenu();
    });
    cellMenuEl.appendChild(btnDecrease);
    cellMenuEl.appendChild(btnClear);
    document.body.appendChild(cellMenuEl);
    const rect = cell.getBoundingClientRect();
    let x = rect.left;
    let y = rect.bottom + 4;
    cellMenuEl.style.left = x + "px";
    cellMenuEl.style.top = y + "px";
    requestAnimationFrame(() => {
      const w = cellMenuEl.offsetWidth;
      const h = cellMenuEl.offsetHeight;
      if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
      if (x < 8) x = 8;
      if (y + h > window.innerHeight - 8) y = rect.top - h - 4;
      if (y < 8) y = 8;
      cellMenuEl.style.left = x + "px";
      cellMenuEl.style.top = y + "px";
    });
    cellMenuClose = () => {
      document.removeEventListener("click", cellMenuClose);
      if (cellMenuEl && cellMenuEl.parentNode) cellMenuEl.remove();
      cellMenuEl = null;
      cellMenuClose = null;
      suppressNextCellClick = null;
    };
    document.addEventListener("click", cellMenuClose);
  }
  function hideCellMenu() {
    if (cellMenuClose) cellMenuClose();
  }

  function renderHeatmapCard(heatmap) {
    const viewRange = heatmap.viewRange == null ? "recent" : heatmap.viewRange;
    const colors = getLevelColors(heatmap.color);
    const gridDates = getGridDates(viewRange);

    const rangeDisplayText = viewRange === "recent" || viewRange == null ? "最近一年" : viewRange + " 年";

    const card = document.createElement("div");
    card.className = "heatmap-card" + (heatmap.collapsed ? " card-collapsed" : "");
    card.id = "card-" + heatmap.id;
    card.dataset.heatmapId = heatmap.id;
    card.dataset.heatmapName = (heatmap.name || "").toLowerCase();
    card.dataset.tags = (heatmap.tags || []).join(" ");
    card.setAttribute("role", "listitem");

    const wrap = document.createElement("div");
    wrap.className = "heatmap-wrap";
    wrap.style.setProperty("--card-accent", heatmap.color);

    const header = document.createElement("header");
    header.className = "heatmap-header";
    const displayName = heatmap.name || "未命名兴趣";
    header.innerHTML =
      '<div class="heatmap-title-wrap">' +
      '<span class="card-drag-handle" draggable="true" aria-label="拖动排序" title="拖动排序"></span>' +
      '<button type="button" class="card-collapse-btn" aria-label="折叠" title="折叠/展开">▶</button>' +
      `<span class="heatmap-title-display" title="点击修改">${escapeHtml(displayName)}</span>` +
      `<input type="text" class="heatmap-title heatmap-title-edit hidden" placeholder="未命名兴趣" maxlength="32" value="${escapeHtml(heatmap.name)}" />` +
      "</div>" +
      '<div class="header-actions">' +
      '<button type="button" class="btn btn-ghost btn-today-plus" title="今日 +1" aria-label="今日记录 +1">今日 +1</button>' +
      '<label class="range-label"><span>时间范围</span><span class="range-select-wrap"><button type="button" class="range-prev" aria-label="上一年" title="上一年">‹</button><button type="button" class="range-display" aria-label="跳转到当前年份" title="点击跳转到当前年份">' +
      escapeHtml(rangeDisplayText) +
      '</button><button type="button" class="range-next" aria-label="下一年" title="下一年">›</button></span></label>' +
      '<div class="card-more-actions-wrap"><button type="button" class="btn btn-ghost btn-more-actions btn-icon-only" title="更多操作" aria-label="更多操作" aria-haspopup="true"><span aria-hidden="true">⋯</span></button><div class="card-actions-dropdown hidden"></div></div>' +
      "</div>" +
      '<span class="header-collapsed-summary hidden" aria-hidden="true"></span>';

    const statsDiv = document.createElement("div");
    statsDiv.className = "heatmap-stats";
    function updateStatsDom() {
      const s = getHeatmapStats(heatmap, heatmap.viewRange == null ? "recent" : heatmap.viewRange);
      statsDiv.innerHTML = `总 <strong>${s.total}</strong> 次 · 最长连续 <strong>${s.streakDays}</strong> 天 · 日均 <strong>${s.avgPerDay.toFixed(2)}</strong> 次`;
    }
    updateStatsDom();

    const legendDiv = document.createElement("div");
    legendDiv.className = "heatmap-legend";
    legendDiv.innerHTML = '<span>少</span><span class="legend-blocks">' + buildLegendHTML(colors) + "</span><span>多</span>";

    const container = document.createElement("div");
    container.className = "heatmap-container";

    const weekdays = document.createElement("div");
    weekdays.className = "heatmap-weekdays";
    weekdays.innerHTML =
      '<span class="heatmap-weekday-spacer"></span>' +
      WEEKDAY_LABELS.map((label) => `<span>${label}</span>`).join("");

    const gridWrap = document.createElement("div");
    gridWrap.className = "heatmap-grid-wrap";

    const months = document.createElement("div");
    months.className = "heatmap-months";
    months.innerHTML = buildMonthLabels(gridDates, viewRange);

    const grid = document.createElement("div");
    grid.className = "heatmap-grid";
    grid.style.gridTemplateRows = `repeat(${DAYS_PER_WEEK}, var(--cell-size))`;

    function updateCellCount(cell, newCount) {
      const key = cell.dataset.key;
      const inYear = cell.dataset.inYear === "1";
      heatmap.data[key] = newCount;
      if (newCount === 0) delete heatmap.data[key];
      save();
      const yearView = typeof heatmap.viewRange === "number";
      const showAsEmpty = yearView && !inYear;
      const displayCount = showAsEmpty ? 0 : newCount;
      const displayLevel = showAsEmpty ? 0 : getLevel(newCount);
      cell.dataset.count = displayCount;
      const isToday = cell.dataset.isToday === "1";
      cell.className = "heatmap-cell level-" + displayLevel + (inYear ? "" : " outside-year") + (isToday ? " heatmap-cell-today" : "");
      if (displayLevel === 0) {
        cell.classList.add("empty");
        cell.style.background = "";
      } else {
        cell.style.background = colors[displayLevel];
      }
      refreshTooltipForCell(cell);
      const card = cell.closest(".heatmap-card");
      const st = card && card.querySelector(".heatmap-stats");
      if (st) {
        const s = getHeatmapStats(heatmap, heatmap.viewRange == null ? "recent" : heatmap.viewRange);
        st.innerHTML = `总 <strong>${s.total}</strong> 次 · 最长连续 <strong>${s.streakDays}</strong> 天 · 日均 <strong>${s.avgPerDay.toFixed(2)}</strong> 次`;
      }
      if (card && card.classList.contains("card-collapsed")) {
        const sum = card.querySelector(".header-collapsed-summary");
        if (sum) {
      const s = getHeatmapStats(heatmap, heatmap.viewRange == null ? "recent" : heatmap.viewRange);
      sum.textContent = `总 ${s.total} 次`;
          sum.classList.remove("hidden");
        }
      }
      const emptyHintEl = card && card.querySelector(".heatmap-empty-hint");
      if (emptyHintEl) {
        const s = getHeatmapStats(heatmap, heatmap.viewRange == null ? "recent" : heatmap.viewRange);
        if (s.total === 0) emptyHintEl.classList.remove("hidden");
        else emptyHintEl.classList.add("hidden");
      }
      const trendWrapEl = card && card.querySelector(".trend-chart-wrap");
      if (trendWrapEl && !trendWrapEl.classList.contains("hidden")) refreshTrendChart();
    }

    const todayKey = formatDateKey(new Date());
    const isYearView = typeof viewRange === "number";
    gridDates.forEach(({ date, row, col, inYear }, cellIndex) => {
      const key = formatDateKey(date);
      const isToday = key === todayKey;
      const count = heatmap.data[key] || 0;
      const level = getLevel(count);
      const showAsEmpty = isYearView && !inYear;
      const displayLevel = showAsEmpty ? 0 : level;
      const displayCount = showAsEmpty ? 0 : count;
      /* 非当年格子仍占位一格，仅不显示数据，不删不挪保证位置不变 */
      const cell = document.createElement("div");
      cell.className = "heatmap-cell level-" + displayLevel + (inYear ? "" : " outside-year") + (isToday ? " heatmap-cell-today" : "");
      cell.style.background = displayLevel === 0 ? "" : colors[displayLevel];
      if (displayLevel === 0) cell.classList.add("empty");
      cell.dataset.key = key;
      cell.dataset.count = displayCount;
      cell.dataset.inYear = inYear ? "1" : "0";
      cell.dataset.isToday = isToday ? "1" : "0";
      cell.setAttribute("aria-label", `${key} ${displayCount}次${isToday ? "（今天）" : ""}${showAsEmpty ? "（非当年）" : ""}`);
      cell.dataset.gridIndex = String(cellIndex);
      cell.tabIndex = -1;

      cell.addEventListener("click", (e) => {
        if (showAsEmpty) return;
        if (suppressNextCellClick === cell) {
          suppressNextCellClick = null;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const cur = (heatmap.data[key] || 0) | 0;
        if (e.shiftKey) {
          if (cur <= 0) return;
          updateCellCount(cell, cur - 1);
        } else {
          updateCellCount(cell, cur + 1);
        }
      });

      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (showAsEmpty) return;
        const cur = (heatmap.data[key] || 0) | 0;
        showCellMenu(e, cell, cur, () => updateCellCount(cell, Math.max(0, cur - 1)), () => updateCellCount(cell, 0));
      });

      cell.addEventListener("touchstart", function (e) {
        if (showAsEmpty) return;
        if (cellLongPressTimer) clearTimeout(cellLongPressTimer);
        cellLongPressTimer = setTimeout(() => {
          cellLongPressTimer = null;
          const cur = (heatmap.data[key] || 0) | 0;
          suppressNextCellClick = cell;
          if (navigator.vibrate) navigator.vibrate(10);
          const touch = e.changedTouches && e.changedTouches[0];
          const ev = touch ? { preventDefault: () => {}, clientX: touch.clientX, clientY: touch.clientY } : e;
          showCellMenu(ev, cell, cur, () => updateCellCount(cell, Math.max(0, cur - 1)), () => updateCellCount(cell, 0));
        }, 500);
      }, { passive: true });
      cell.addEventListener("touchend", function () {
        if (cellLongPressTimer) {
          clearTimeout(cellLongPressTimer);
          cellLongPressTimer = null;
        }
      }, { passive: true });
      cell.addEventListener("touchmove", function () {
        if (cellLongPressTimer) {
          clearTimeout(cellLongPressTimer);
          cellLongPressTimer = null;
        }
      }, { passive: true });

      cell.addEventListener("mouseenter", (e) => showTooltip(e, key, () => e.target.dataset.count));
      cell.addEventListener("mouseleave", hideTooltip);
      cell.addEventListener("keydown", function (e) {
        const idx = parseInt(this.dataset.gridIndex, 10);
        const total = gridDates.length;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!showAsEmpty) this.click();
          return;
        }
        let nextIdx = -1;
        if (e.key === "ArrowRight") nextIdx = idx + 7;
        else if (e.key === "ArrowLeft") nextIdx = idx - 7;
        else if (e.key === "ArrowDown") nextIdx = idx + 1;
        else if (e.key === "ArrowUp") nextIdx = idx - 1;
        if (nextIdx >= 0 && nextIdx < total) {
          e.preventDefault();
          const next = grid.children[nextIdx];
          if (next && !next.classList.contains("outside-year")) next.focus();
        }
      });
      grid.appendChild(cell);
    });
    grid.setAttribute("tabindex", "0");
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", heatmap.name + " 热力图");
    grid.addEventListener("focus", function () {
      const todayEl = grid.querySelector("[data-is-today='1']");
      if (todayEl) todayEl.focus();
      else if (grid.firstElementChild) grid.firstElementChild.focus();
    });

    gridWrap.appendChild(months);
    gridWrap.appendChild(grid);
    container.appendChild(weekdays);
    container.appendChild(gridWrap);

    scrollHeatmapToToday(gridWrap, grid, todayKey, gridDates);

    const hint = document.createElement("p");
    hint.className = "heatmap-hint";
    hint.textContent = "点击增加 · Shift+点击减少 · 长按或右键可减少/清零";
    const emptyHint = document.createElement("p");
    emptyHint.className = "heatmap-empty-hint hidden";
    emptyHint.textContent = "点击任意格子开始记录";
    function updateEmptyHint() {
      const s = getHeatmapStats(heatmap, heatmap.viewRange == null ? "recent" : heatmap.viewRange);
      if (s.total === 0) emptyHint.classList.remove("hidden");
      else emptyHint.classList.add("hidden");
    }
    updateEmptyHint();
    const trendToggle = document.createElement("button");
    trendToggle.type = "button";
    trendToggle.className = "btn btn-ghost btn-small trend-toggle";
    trendToggle.textContent = "趋势图";
    const trendChartWrap = document.createElement("div");
    trendChartWrap.className = "trend-chart-wrap" + (heatmap.trendExpanded ? "" : " hidden");
    trendChartWrap.setAttribute("aria-hidden", heatmap.trendExpanded ? "false" : "true");
    function refreshTrendChart() {
      const viewRange = heatmap.viewRange == null ? "recent" : heatmap.viewRange;
      const trendData = getTrendDataByMonth(heatmap, viewRange);
      const allZero = trendData.every((x) => x.total === 0);
      trendChartWrap.innerHTML = "";
      trendChartWrap.classList.remove("trend-chart-empty");
      if (allZero) {
        const emptyTip = document.createElement("p");
        emptyTip.className = "trend-chart-empty-tip";
        emptyTip.textContent = "暂无数据";
        trendChartWrap.classList.add("trend-chart-empty");
        trendChartWrap.appendChild(emptyTip);
        return;
      }
      const maxVal = Math.max(1, ...trendData.map((x) => x.total));
      const h = 80;
      const gap = 4;
      const barW = 24;
      const n = trendData.length;
      const w = n * barW + (n - 1) * gap;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);
      svg.setAttribute("class", "trend-svg");
      svg.setAttribute("preserveAspectRatio", "none");
      trendData.forEach((d, i) => {
        const barH = maxVal ? (d.total / maxVal) * (h - 16) : 0;
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", i * (barW + gap));
        rect.setAttribute("y", h - 16 - barH);
        rect.setAttribute("width", barW);
        rect.setAttribute("height", barH || 0);
        rect.setAttribute("fill", heatmap.color);
        rect.setAttribute("rx", 2);
        svg.appendChild(rect);
      });
      trendChartWrap.appendChild(svg);
    }
    trendToggle.addEventListener("click", function () {
      trendChartWrap.classList.toggle("hidden");
      const isExpanded = !trendChartWrap.classList.contains("hidden");
      trendChartWrap.setAttribute("aria-hidden", isExpanded ? "false" : "true");
      heatmap.trendExpanded = isExpanded;
      save();
      if (isExpanded) refreshTrendChart();
    });
    const cardBody = document.createElement("div");
    cardBody.className = "heatmap-card-body" + (heatmap.collapsed ? " collapsed" : "");
    cardBody.setAttribute("aria-hidden", heatmap.collapsed ? "true" : "false");
    cardBody.appendChild(statsDiv);
    cardBody.appendChild(legendDiv);
    cardBody.appendChild(emptyHint);
    cardBody.appendChild(container);
    cardBody.appendChild(trendToggle);
    cardBody.appendChild(trendChartWrap);
    cardBody.appendChild(hint);
    wrap.appendChild(header);
    wrap.appendChild(cardBody);
    card.appendChild(wrap);

    if (heatmap.trendExpanded) refreshTrendChart();

    const titleDisplay = header.querySelector(".heatmap-title-display");
    const titleInput = header.querySelector(".heatmap-title");
    const moreBtn = header.querySelector(".btn-more-actions");
    const actionsDropdown = header.querySelector(".card-actions-dropdown");
    const collapseBtn = header.querySelector(".card-collapse-btn");
    const collapsedSummary = header.querySelector(".header-collapsed-summary");
    function updateCollapsedSummary() {
      if (!collapsedSummary) return;
      if (!heatmap.collapsed) {
        collapsedSummary.classList.add("hidden");
        collapsedSummary.textContent = "";
        return;
      }
      const s = getHeatmapStats(heatmap, heatmap.viewRange == null ? "recent" : heatmap.viewRange);
      collapsedSummary.textContent = `总 ${s.total} 次`;
      collapsedSummary.classList.remove("hidden");
    }
    if (collapseBtn) {
      collapseBtn.addEventListener("click", function () {
        heatmap.collapsed = !heatmap.collapsed;
        save();
        card.classList.toggle("card-collapsed", heatmap.collapsed);
        cardBody.classList.toggle("collapsed", heatmap.collapsed);
        cardBody.setAttribute("aria-hidden", heatmap.collapsed ? "true" : "false");
        collapseBtn.textContent = heatmap.collapsed ? "▼" : "▶";
        collapseBtn.setAttribute("aria-label", heatmap.collapsed ? "展开" : "折叠");
        updateCollapsedSummary();
      });
      collapseBtn.textContent = heatmap.collapsed ? "▼" : "▶";
      collapseBtn.setAttribute("aria-label", heatmap.collapsed ? "展开" : "折叠");
    }
    updateCollapsedSummary();

    const btnTodayPlus = header.querySelector(".btn-today-plus");
    if (btnTodayPlus) {
      btnTodayPlus.addEventListener("click", function () {
        const todayKeyNow = formatDateKey(new Date());
        const cur = heatmap.data[todayKeyNow] || 0;
        const newCount = cur + 1;
        heatmap.data[todayKeyNow] = newCount;
        save();
        const cell = grid.querySelector('[data-key="' + todayKeyNow + '"]');
        if (cell) updateCellCount(cell, newCount);
        else {
          updateStatsDom();
          if (card.classList.contains("card-collapsed")) {
            const s = getHeatmapStats(heatmap, heatmap.viewRange == null ? "recent" : heatmap.viewRange);
            if (collapsedSummary) { collapsedSummary.textContent = "总 " + s.total + " 次"; collapsedSummary.classList.remove("hidden"); }
          }
          const trendWrap = card.querySelector(".trend-chart-wrap");
          if (trendWrap && !trendWrap.classList.contains("hidden")) refreshTrendChart();
        }
      });
    }

    function commitTitle() {
      const val = titleInput.value.trim() || "未命名兴趣";
      heatmap.name = val;
      save();
      titleDisplay.textContent = val;
      titleDisplay.classList.remove("hidden");
      titleInput.classList.add("hidden");
    }

    titleDisplay.addEventListener("click", function () {
      titleDisplay.classList.add("hidden");
      titleInput.classList.remove("hidden");
      titleInput.value = heatmap.name || "";
      titleInput.focus();
      titleInput.select();
    });
    titleInput.addEventListener("blur", function () {
      commitTitle();
    });
    titleInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        titleInput.blur();
      }
    });

    function applyRangeValue(value) {
      heatmap.viewRange = value === "recent" ? "recent" : value;
      save();
      renderAllHeatmaps();
    }

    const rangePrev = header.querySelector(".range-prev");
    const rangeNext = header.querySelector(".range-next");
    const rangeDisplay = header.querySelector(".range-display");
    const currentYear = new Date().getFullYear();

    if (rangeDisplay) {
      rangeDisplay.addEventListener("click", function () {
        applyRangeValue(currentYear);
      });
    }

    function updateRangeButtonsState() {
      const cur = heatmap.viewRange == null ? "recent" : heatmap.viewRange;
      const years = getYearOptions(typeof cur === "number" ? cur : undefined);
      const minYear = years.length ? Math.min(...years) : currentYear - 10;
      if (rangePrev) rangePrev.disabled = cur !== "recent" && Number(cur) <= minYear;
      if (rangeNext) rangeNext.disabled = cur === "recent";
    }
    if (rangePrev) {
      rangePrev.addEventListener("click", function () {
        if (this.disabled) return;
        const cur = heatmap.viewRange == null ? "recent" : heatmap.viewRange;
        if (cur === "recent") {
          applyRangeValue(currentYear);
          return;
        }
        const y = Number(cur);
        if (!isNaN(y)) applyRangeValue(y - 1);
      });
    }
    if (rangeNext) {
      rangeNext.addEventListener("click", function () {
        if (this.disabled) return;
        const cur = heatmap.viewRange == null ? "recent" : heatmap.viewRange;
        if (cur === "recent") return;
        const y = Number(cur);
        if (isNaN(y)) return;
        if (y < currentYear) applyRangeValue(y + 1);
        else if (y === currentYear) applyRangeValue("recent");
      });
    }
    updateRangeButtonsState();

    (function setupMoreActionsDropdown() {
      const wrap = header.querySelector(".card-more-actions-wrap");
      const rgb = hexToRgb(heatmap.color);
      const presetsHtml = COLOR_PRESETS.map((hex) => `<button type="button" class="color-preset" style="background:${hex}" data-color="${hex}" aria-label="颜色 ${hex}"></button>`).join("");
      const tagsList = (heatmap.tags || []).map((t) => escapeHtml(t)).join("");
      actionsDropdown.innerHTML =
        '<div class="card-actions-section">' +
        '<div class="card-actions-section-title"><span class="color-swatch-preview" style="background:' + heatmap.color + '" aria-hidden="true"></span>设置颜色</div>' +
        '<div class="color-presets">' + presetsHtml + '</div>' +
        '<div class="color-picker-row"><span>R</span><input type="range" min="0" max="255" class="color-range color-r"></div>' +
        '<div class="color-picker-row"><span>G</span><input type="range" min="0" max="255" class="color-range color-g"></div>' +
        '<div class="color-picker-row"><span>B</span><input type="range" min="0" max="255" class="color-range color-b"></div>' +
        '<div class="color-picker-row"><span>#</span><input type="text" class="color-hex" maxlength="7" placeholder="#000000"></div>' +
        '</div>' +
        '<div class="card-actions-divider"></div>' +
        '<div class="card-actions-section card-actions-tags">' +
        '<div class="card-actions-section-title">标签</div>' +
        '<div class="card-tags-list" data-tags-container></div>' +
        '<div class="card-tag-add"><input type="text" class="card-tag-input" placeholder="添加标签" maxlength="12" /><button type="button" class="btn btn-ghost btn-small card-tag-add-btn">添加</button></div>' +
        '</div>' +
        '<div class="card-actions-divider"></div>' +
        '<button type="button" class="card-action-delete">删除</button>';
      const swatchPreview = actionsDropdown.querySelector(".color-swatch-preview");
      const rInput = actionsDropdown.querySelector(".color-r");
      const gInput = actionsDropdown.querySelector(".color-g");
      const bInput = actionsDropdown.querySelector(".color-b");
      const hexInput = actionsDropdown.querySelector(".color-hex");
      rInput.value = rgb.r;
      gInput.value = rgb.g;
      bInput.value = rgb.b;
      hexInput.value = heatmap.color;

      function applyColor(hex) {
        hex = hex.startsWith("#") ? hex : "#" + hex;
        if (!/^#[0-f]{6}$/i.test(hex)) return;
        heatmap.color = hex;
        save();
        if (swatchPreview) swatchPreview.style.background = hex;
        hexInput.value = hex;
        const c = hexToRgb(hex);
        rInput.value = c.r;
        gInput.value = c.g;
        bInput.value = c.b;
        const newColors = getLevelColors(hex);
        const legendBlocks = card.querySelector(".legend-blocks");
        if (legendBlocks) legendBlocks.innerHTML = [0, 1, 2, 3, 4].map((i) => `<span style="background: ${newColors[i]}; border: ${i === 0 ? "1px solid var(--border)" : "none"};"></span>`).join("");
        card.querySelectorAll(".heatmap-cell").forEach((cell) => {
          const level = parseInt(cell.dataset.count || "0", 10);
          const displayLevel = level <= 0 ? 0 : getLevel(level);
          cell.style.background = displayLevel === 0 ? "" : newColors[displayLevel];
        });
      }
      function syncFromRgb() {
        const r = parseInt(rInput.value, 10);
        const g = parseInt(gInput.value, 10);
        const b = parseInt(bInput.value, 10);
        applyColor(rgbToHex(r, g, b));
      }
      actionsDropdown.querySelectorAll(".color-preset").forEach((btn) => {
        btn.addEventListener("click", function () {
          applyColor(this.dataset.color);
        });
      });
      rInput.addEventListener("input", syncFromRgb);
      gInput.addEventListener("input", syncFromRgb);
      bInput.addEventListener("input", syncFromRgb);
      hexInput.addEventListener("input", function () {
        const v = this.value.trim();
        if (/^#?[0-9a-fA-F]{6}$/.test(v)) applyColor(v.startsWith("#") ? v : "#" + v);
      });
      hexInput.addEventListener("change", function () {
        const v = this.value.trim();
        if (v && /^#?[0-9a-fA-F]{6}$/.test(v)) applyColor(v.startsWith("#") ? v : "#" + v);
        else this.value = heatmap.color;
      });

      actionsDropdown.querySelector(".card-action-delete").addEventListener("click", function () {
        actionsDropdown.classList.add("hidden");
        showConfirmModal({
          message: "确定要删除这个兴趣记录吗？",
          onConfirm: function () {
            const idx = getHeatmapIndex(heatmap.id);
            if (idx === -1) return;
            heatmaps.splice(idx, 1);
            save();
            renderAllHeatmaps();
          },
        });
      });

      const tagsContainer = actionsDropdown.querySelector("[data-tags-container]");
      const tagInput = actionsDropdown.querySelector(".card-tag-input");
      const tagAddBtn = actionsDropdown.querySelector(".card-tag-add-btn");
      function renderTagsInDropdown() {
        if (!tagsContainer) return;
        const tags = heatmap.tags || [];
        tagsContainer.innerHTML = tags
          .map(
            (t) =>
              '<span class="card-tag-pill">' +
              escapeHtml(t) +
              '<button type="button" class="card-tag-remove" data-tag="' +
              escapeHtml(t) +
              '" aria-label="移除">×</button></span>'
          )
          .join("");
        tagsContainer.querySelectorAll(".card-tag-remove").forEach((btn) => {
          btn.addEventListener("click", function () {
            const tagVal = this.getAttribute("data-tag");
            heatmap.tags = (heatmap.tags || []).filter((x) => x !== tagVal);
            save();
            renderTagsInDropdown();
            renderTagFilterBar();
          });
        });
      }
      renderTagsInDropdown();
      function addTag() {
        const val = tagInput && tagInput.value.trim();
        if (!val) return;
        const tags = heatmap.tags || [];
        if (tags.indexOf(val) >= 0) return;
        heatmap.tags = tags.concat([val]);
        save();
        if (tagInput) tagInput.value = "";
        renderTagsInDropdown();
        renderTagFilterBar();
      }
      if (tagAddBtn) tagAddBtn.addEventListener("click", addTag);
      if (tagInput) {
        tagInput.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            addTag();
          }
        });
      }

      moreBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        document.querySelectorAll(".card-actions-dropdown").forEach((d) => {
          if (d !== actionsDropdown) d.classList.add("hidden");
        });
        actionsDropdown.classList.toggle("hidden");
      });
      document.addEventListener("click", function closeDropdown(e) {
        if (!wrap || !wrap.contains(e.target)) {
          actionsDropdown.classList.add("hidden");
        }
      });
    })();

    return card;
  }

  function showConfirmModal(options) {
    const { message = "确定吗？", onConfirm } = options;
    const modal = $("confirmModal");
    const messageEl = $("confirmModalMessage");
    const cancelBtn = $("confirmModalCancel");
    const confirmBtn = $("confirmModalConfirm");
    const backdrop = $("confirmModalBackdrop");
    if (!modal || !messageEl) return;
    messageEl.textContent = message;
    modal.classList.remove("hidden");

    function close() {
      modal.classList.add("hidden");
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirmClick);
      backdrop.removeEventListener("click", onBackdropClick);
      document.removeEventListener("keydown", onEsc);
    }
    function onCancel() {
      close();
    }
    function onConfirmClick() {
      close();
      if (typeof onConfirm === "function") onConfirm();
    }
    function onBackdropClick(e) {
      if (e.target === backdrop) close();
    }
    function onEsc(e) {
      if (e.key === "Escape") {
        close();
        e.preventDefault();
      }
    }
    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirmClick);
    backdrop.addEventListener("click", onBackdropClick);
    document.addEventListener("keydown", onEsc);
  }

  function getHeatmapsToRender() {
    if (!selectedTag) return heatmaps;
    return heatmaps.filter((h) => (h.tags || []).indexOf(selectedTag) >= 0);
  }

  function renderTagFilterBar() {
    const bar = $("tagFilterBar");
    const pillsEl = $("tagFilterPills");
    if (!bar || !pillsEl) return;
    const allTags = [];
    heatmaps.forEach((h) => {
      (h.tags || []).forEach((t) => {
        if (t && allTags.indexOf(t) === -1) allTags.push(t);
      });
    });
    if (allTags.length === 0) {
      bar.classList.add("hidden");
      return;
    }
    bar.classList.remove("hidden");
    pillsEl.innerHTML = allTags
      .map(
        (t) =>
          '<button type="button" class="tag-filter-pill" data-tag="' +
          escapeHtml(t) +
          '">' +
          escapeHtml(t) +
          "</button>"
      )
      .join("");
    bar.querySelectorAll(".tag-filter-pill").forEach((btn) => {
      const tag = btn.getAttribute("data-tag");
      btn.classList.toggle("active", tag === selectedTag);
      btn.addEventListener("click", function () {
        selectedTag = tag === selectedTag ? "" : tag;
        bar.querySelectorAll(".tag-filter-pill").forEach((b) => b.classList.toggle("active", b.getAttribute("data-tag") === selectedTag));
        renderAllHeatmaps();
      });
    });
    const allBtn = bar.querySelector('.tag-filter-pill[data-tag=""]');
    if (allBtn) allBtn.classList.toggle("active", !selectedTag);
  }

  function updateFirstUseHint() {
    const hintEl = $("firstUseHint");
    if (!hintEl) return;
    const toRender = getHeatmapsToRender();
    const single = heatmaps.length === 1 && toRender.length === 1;
    const total = single ? getHeatmapStats(toRender[0], toRender[0].viewRange == null ? "recent" : toRender[0].viewRange).total : 1;
    if (single && total === 0) {
      hintEl.classList.remove("hidden");
      const firstCard = heatmapCards.querySelector(".heatmap-card");
      if (firstCard) firstCard.classList.add("has-first-use-hint");
    } else {
      hintEl.classList.add("hidden");
      heatmapCards.querySelectorAll(".has-first-use-hint").forEach((c) => c.classList.remove("has-first-use-hint"));
    }
  }

  function renderAllHeatmaps() {
    heatmapCards.innerHTML = "";
    const toRender = getHeatmapsToRender();
    if (toRender.length === 0) {
      mainPlaceholder.classList.remove("hidden");
      heatmapCards.classList.add("hidden");
      const placeholderText = mainPlaceholder ? mainPlaceholder.querySelector("[data-placeholder-text]") : null;
      if (placeholderText)
        placeholderText.textContent = selectedTag ? "当前标签下暂无兴趣" : "点击「新建兴趣」开始记录";
    } else {
      mainPlaceholder.classList.add("hidden");
      heatmapCards.classList.remove("hidden");
      toRender.forEach((h) => heatmapCards.appendChild(renderHeatmapCard(h)));
    }
    renderTagFilterBar();
    updateFirstUseHint();
  }

  function setupCardDragDrop() {
    heatmapCards.addEventListener("dragstart", function (e) {
      const handle = e.target.closest(".card-drag-handle");
      if (!handle) return;
      const card = handle.closest(".heatmap-card");
      if (!card) return;
      e.dataTransfer.setData("text/plain", card.dataset.heatmapId);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("card-dragging");
    });
    heatmapCards.addEventListener("dragover", function (e) {
      const card = e.target.closest(".heatmap-card");
      if (!card) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      heatmapCards.querySelectorAll(".heatmap-card").forEach((c) => c.classList.remove("card-drag-over"));
      card.classList.add("card-drag-over");
    });
    heatmapCards.addEventListener("dragleave", function (e) {
      if (!e.target.closest(".heatmap-card")) return;
      const card = e.target.closest(".heatmap-card");
      if (!heatmapCards.contains(e.relatedTarget) || !card.contains(e.relatedTarget)) card.classList.remove("card-drag-over");
    });
    heatmapCards.addEventListener("drop", function (e) {
      e.preventDefault();
      heatmapCards.querySelectorAll(".heatmap-card").forEach((c) => c.classList.remove("card-drag-over"));
      const targetCard = e.target.closest(".heatmap-card");
      if (!targetCard) return;
      const draggedId = e.dataTransfer.getData("text/plain");
      if (!draggedId || targetCard.dataset.heatmapId === draggedId) return;
      const fromIdx = heatmaps.findIndex((h) => h.id === draggedId);
      let toIdx = heatmaps.findIndex((h) => h.id === targetCard.dataset.heatmapId);
      if (fromIdx === -1 || toIdx === -1) return;
      const [item] = heatmaps.splice(fromIdx, 1);
      if (fromIdx < toIdx) toIdx--;
      heatmaps.splice(toIdx, 0, item);
      save();
      const draggedEl = heatmapCards.querySelector("#card-" + draggedId);
      if (draggedEl) heatmapCards.insertBefore(draggedEl, targetCard);
    });
    heatmapCards.addEventListener("dragend", function (e) {
      heatmapCards.querySelectorAll(".heatmap-card").forEach((c) => {
        c.classList.remove("card-dragging", "card-drag-over");
      });
    });
  }

  function addNewHeatmap() {
    const heatmap = createHeatmap();
    heatmaps.push(heatmap);
    save();
    renderAllHeatmaps();
    const card = $("card-" + heatmap.id);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function getSyncToken() {
    return localStorage.getItem(SYNC_TOKEN_KEY) || "";
  }
  function setSyncToken(token) {
    if (token) localStorage.setItem(SYNC_TOKEN_KEY, token);
    else localStorage.removeItem(SYNC_TOKEN_KEY);
  }
  function getGistId() {
    return localStorage.getItem(GIST_ID_KEY) || "";
  }
  function setGistId(id) {
    if (id) localStorage.setItem(GIST_ID_KEY, id);
    else localStorage.removeItem(GIST_ID_KEY);
  }

  function setSyncStatus(message, isError) {
    const el = $("syncStatus");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("error", !!isError);
    el.classList.toggle("success", !isError && message);
  }

  function setSyncLoading(loading) {
    syncInProgress = loading;
    const btnPush = $("btnSyncPush");
    const btnPull = $("btnSyncPull");
    const indicator = $("syncLoadingIndicator");
    if (btnPush) btnPush.disabled = loading;
    if (btnPull) btnPull.disabled = loading;
    if (btnPush) btnPush.classList.toggle("loading", loading);
    if (btnPull) btnPull.classList.toggle("loading", loading);
    if (indicator) indicator.classList.toggle("hidden", !loading);
  }

  async function pushToGist() {
    const token = ($("syncToken") && $("syncToken").value.trim()) || getSyncToken();
    const gistId = getGistId();
    console.log("[日迹 sync] pushToGist() 开始", { hasToken: !!token, hasGistId: !!gistId });
    if (!token) {
      setSyncStatus("请先填写并保存 Token", true);
      return;
    }
    setSyncLoading(true);
    setSyncStatus("推送中…");
    const body = JSON.stringify(heatmaps);
    const opts = {
      method: gistId ? "PATCH" : "POST",
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: "token " + token,
        "Content-Type": "application/json",
      },
      body: gistId
        ? JSON.stringify({ files: { [GIST_FILENAME]: { content: body } } })
        : JSON.stringify({
            description: "兴趣记录热力图",
            public: false,
            files: { [GIST_FILENAME]: { content: body } },
          }),
    };
    const url = gistId ? GIST_API + "/" + gistId : GIST_API;
    try {
      const res = await fetch(url, opts);
      const data = await res.json();
      console.log("[日迹 sync] pushToGist 响应", { status: res.status, ok: res.ok, message: data.message });
      if (!res.ok) {
        const msg = data.message || "推送失败 " + res.status;
        const rateHint = formatRateLimitHint(res);
        setSyncStatus(msg + rateHint, true);
        lastSyncErrorMessage = "推送失败，请打开「云同步」查看。限额用尽时可等待约 1 小时后重试。";
        updateSyncStatusText();
        const remaining = res.headers.get("X-RateLimit-Remaining");
        const resetSec = res.headers.get("X-RateLimit-Reset");
        if ((res.status === 403 || remaining === "0") && resetSec) pauseSyncPullUntilReset(parseInt(resetSec, 10));
        console.warn("[日迹 sync] 推送失败", msg, rateHint);
        return;
      }
      lastSyncErrorMessage = null;
      if (data.id) {
        setGistId(data.id);
        const gistInput = $("syncGistIdBind");
        if (gistInput) gistInput.value = data.id;
        updateSyncStatusBar();
      }
      lastSyncedSnapshot = body;
      localStorage.setItem(SYNC_LAST_PUSH_KEY, String(Date.now()));
      localStorage.setItem(SYNC_LAST_SNAPSHOT_KEY, body);
      updateSyncStatusText();
      setSyncStatus("已推送到云端 " + new Date().toLocaleTimeString("zh-CN"));
      console.log("[日迹 sync] 推送成功");
    } catch (err) {
      console.warn("[日迹 sync] 推送异常", err);
      setSyncStatus("网络错误：" + (err.message || "未知"), true);
      lastSyncErrorMessage = "推送失败，请打开「云同步」查看";
      updateSyncStatusText();
    } finally {
      setSyncLoading(false);
    }
  }

  async function pullFromGist(opts) {
    const { skipDirtyCheck = false } = opts || {};
    const token = ($("syncToken") && $("syncToken").value.trim()) || getSyncToken();
    const gistId = getGistId();
    if (!token) {
      setSyncStatus("请先填写并保存 Token", true);
      return false;
    }
    if (!gistId) {
      setSyncStatus("请先执行一次「推送到云端」或绑定 Gist ID", true);
      return false;
    }
    if (!skipDirtyCheck && isDirty() && !confirm("本地有未同步的更改，拉取将覆盖本地数据。是否继续？")) return false;
    setSyncLoading(true);
    setSyncStatus("拉取中…");
    try {
      const res = await fetch(GIST_API + "/" + gistId, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: "token " + token,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.message || "拉取失败 " + res.status;
        const rateHint = formatRateLimitHint(res);
        setSyncStatus(msg + rateHint, true);
        const limit = res.headers.get("X-RateLimit-Limit");
        const remaining = res.headers.get("X-RateLimit-Remaining");
        const resetSec = res.headers.get("X-RateLimit-Reset");
        lastSyncErrorMessage = limit === "60" ? "API 限制。请在本页打开「云同步」保存 Token。" : "拉取失败，请打开「云同步」查看。限额用尽时可等待约 1 小时后重试。";
        updateSyncStatusText();
        if ((res.status === 403 || remaining === "0") && resetSec) pauseSyncPullUntilReset(parseInt(resetSec, 10));
        return false;
      }
      const file = data.files && data.files[GIST_FILENAME];
      if (!file || file.content == null) {
        setSyncStatus("Gist 中未找到 " + GIST_FILENAME, true);
        return false;
      }
      const parsed = JSON.parse(file.content);
      if (!Array.isArray(parsed)) {
        setSyncStatus("数据格式无效", true);
        return false;
      }
      heatmaps = parsed;
      lastSyncErrorMessage = null;
      lastSyncedSnapshot = JSON.stringify(heatmaps);
      localStorage.setItem(SYNC_LAST_PUSH_KEY, String(Date.now()));
      localStorage.setItem(SYNC_LAST_SNAPSHOT_KEY, lastSyncedSnapshot);
      save();
      renderAllHeatmaps();
      updateSyncStatusText();
      setSyncStatus("已从云端拉取 " + new Date().toLocaleTimeString("zh-CN"));
      return true;
    } catch (err) {
      setSyncStatus("网络错误：" + (err.message || "未知"), true);
      return false;
    } finally {
      setSyncLoading(false);
    }
  }

  function updateSyncStatusBar() {
    const bar = $("syncStatusBar");
    const textEl = $("syncStatusBarText");
    if (!bar || !textEl) return;
    const token = getSyncToken();
    const gistId = getGistId();
    if (token) {
      bar.classList.remove("hidden");
      textEl.textContent = gistId ? "已配置 Token, Gist ID: " + gistId.slice(0, 8) + "..." : "已配置 Token";
    } else {
      bar.classList.add("hidden");
    }
  }

  function openSyncPanel() {
    const panel = $("syncPanel");
    const tokenInput = $("syncToken");
    const gistBind = $("syncGistIdBind");
    if (panel) panel.classList.remove("hidden");
    if (tokenInput) {
      tokenInput.value = getSyncToken() || "";
      tokenInput.type = "password";
    }
    const eyeBtn = $("syncTokenEye");
    if (eyeBtn) eyeBtn.setAttribute("aria-label", "显示 Token");
    if (gistBind) gistBind.value = getGistId() || "";
    updateSyncStatusBar();
    trapFocus(panel);
  }
  function closeSyncPanel() {
    const panel = $("syncPanel");
    if (panel) panel.classList.add("hidden");
    $("btnSync") && $("btnSync").focus();
  }
  function trapFocus(panel) {
    const focusables = panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    function onKeyDown(e) {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last && last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first && first.focus();
        }
      }
    }
    panel.addEventListener("keydown", onKeyDown);
    const cancel = () => {
      panel.removeEventListener("keydown", onKeyDown);
    };
    const closeBtn = panel.querySelector("#syncClose");
    if (closeBtn) {
      const once = () => { cancel(); };
      panel.addEventListener("keydown", function esc(e) {
        if (e.key === "Escape") { closeSyncPanel(); panel.removeEventListener("keydown", esc); }
      });
    }
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify(heatmaps, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "habits-tracker-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function exportCsv() {
    const rows = [["id", "name", "color", "viewRange", "tags", "date", "count"]];
    heatmaps.forEach((h) => {
      const keys = Object.keys(h.data || {}).sort();
      const tagsStr = (h.tags || []).join(";");
      if (keys.length === 0) rows.push([h.id, h.name, h.color, String(h.viewRange), tagsStr, "", "0"]);
      else keys.forEach((key) => rows.push([h.id, h.name, h.color, String(h.viewRange), tagsStr, key, String(h.data[key])]));
    });
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "habits-tracker-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function normalizeImportedHeatmap(h) {
    if (!h.id) h.id = uuid();
    if (h.collapsed == null) h.collapsed = false;
    if (!Array.isArray(h.tags)) h.tags = [];
    if (!h.data || typeof h.data !== "object") h.data = {};
    return h;
  }

  function importJson(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return false;
    }
    if (!Array.isArray(data)) return false;
    const normalized = data.map(normalizeImportedHeatmap);
    const mode = heatmaps.length === 0 ? "replace" : confirm("当前已有数据。选择「确定」合并到当前数据，选择「取消」则用导入数据覆盖。") ? "merge" : "replace";
    if (mode === "replace") heatmaps = normalized;
    else heatmaps = heatmaps.concat(normalized);
    save();
    renderAllHeatmaps();
    return true;
  }

  function importCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 1) return false;
    const parseRow = (line) => {
      const out = [];
      let inQuote = false;
      let cell = "";
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQuote && line[i + 1] === '"') {
            cell += '"';
            i++;
          } else inQuote = !inQuote;
        } else if (!inQuote && c === ",") {
          out.push(cell);
          cell = "";
        } else cell += c;
      }
      out.push(cell);
      return out;
    };
    const header = parseRow(lines[0]);
    const idIdx = header.indexOf("id");
    const nameIdx = header.indexOf("name");
    const colorIdx = header.indexOf("color");
    const viewRangeIdx = header.indexOf("viewRange");
    const tagsIdx = header.indexOf("tags");
    const dateIdx = header.indexOf("date");
    const countIdx = header.indexOf("count");
    if (idIdx < 0 || nameIdx < 0 || dateIdx < 0 || countIdx < 0) return false;
    const byId = {};
    for (let i = 1; i < lines.length; i++) {
      const row = parseRow(lines[i]);
      const id = row[idIdx] || uuid();
      if (!byId[id]) {
        byId[id] = {
          id,
          name: row[nameIdx] || "未命名",
          color: row[colorIdx] || "#216e39",
          viewRange: row[viewRangeIdx] ? (isNaN(Number(row[viewRangeIdx])) ? row[viewRangeIdx] : Number(row[viewRangeIdx])) : new Date().getFullYear(),
          tags: row[tagsIdx] ? row[tagsIdx].split(";").filter(Boolean) : [],
          data: {},
          collapsed: false,
        };
      }
      const date = row[dateIdx];
      const count = parseInt(row[countIdx], 10) || 0;
      if (date) byId[id].data[date] = count;
    }
    const normalized = Object.values(byId).map(normalizeImportedHeatmap);
    const mode = heatmaps.length === 0 ? "replace" : confirm("当前已有数据。选择「确定」合并，选择「取消」覆盖。") ? "merge" : "replace";
    if (mode === "replace") heatmaps = normalized;
    else heatmaps = heatmaps.concat(normalized);
    save();
    renderAllHeatmaps();
    return true;
  }

  function importFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      const text = reader.result;
      const isCsv = /\.csv$/i.test(file.name);
      const ok = isCsv ? importCsv(text) : importJson(text);
      if (!ok) alert("导入失败，请检查文件格式（JSON 需为数组，CSV 需含 id,name,date,count 列）");
    };
    reader.readAsText(file, "UTF-8");
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme || "light");
    localStorage.setItem(THEME_KEY, theme || "light");
    const btn = $("btnTheme");
    if (btn) btn.setAttribute("aria-label", theme === "dark" ? "切换为浅色" : "切换为深色");
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  }

  function bindEvents() {
    $("btnNew").addEventListener("click", addNewHeatmap);

    const btnExport = $("btnExport");
    const exportDropdown = $("exportDropdown");
    if (btnExport && exportDropdown) {
      btnExport.addEventListener("click", function (e) {
        e.stopPropagation();
        exportDropdown.classList.toggle("hidden");
      });
      document.addEventListener("click", function () { exportDropdown.classList.add("hidden"); });
      exportDropdown.addEventListener("click", function (e) { e.stopPropagation(); });
      $("btnExportJson") && $("btnExportJson").addEventListener("click", function () { exportJson(); exportDropdown.classList.add("hidden"); });
      $("btnExportCsv") && $("btnExportCsv").addEventListener("click", function () { exportCsv(); exportDropdown.classList.add("hidden"); });
    }
    const btnImport = $("btnImport");
    const importFileInput = $("importFileInput");
    if (btnImport && importFileInput) {
      btnImport.addEventListener("click", function () { importFileInput.click(); });
      importFileInput.addEventListener("change", function () {
        const file = importFileInput.files && importFileInput.files[0];
        if (file) importFromFile(file);
        importFileInput.value = "";
      });
    }
    const btnTheme = $("btnTheme");
    if (btnTheme) btnTheme.addEventListener("click", toggleTheme);
    document.addEventListener("keydown", function (e) {
      if (e.key === "n" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNewHeatmap(); return; }
      if (e.key === "N" && !e.ctrlKey && !e.metaKey && document.activeElement && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); addNewHeatmap(); return; }
      if (e.key === "Escape") {
        const panel = $("syncPanel");
        if (panel && !panel.classList.contains("hidden")) { closeSyncPanel(); return; }
        const openPicker = document.querySelector(".color-picker-dropdown:not(.hidden)");
        if (openPicker) { openPicker.classList.add("hidden"); return; }
        const openCardActions = document.querySelector(".card-actions-dropdown:not(.hidden)");
        if (openCardActions) { openCardActions.classList.add("hidden"); return; }
        exportDropdown && !exportDropdown.classList.contains("hidden") && exportDropdown.classList.add("hidden");
      }
    });

    const btnSync = $("btnSync");
    const syncStatusText = $("syncStatusText");
    const syncPanel = $("syncPanel");
    const syncClose = $("syncClose");
    if (btnSync) btnSync.addEventListener("click", openSyncPanel);
    if (syncClose) syncClose.addEventListener("click", closeSyncPanel);
    if (syncPanel) {
      syncPanel.addEventListener("click", function (e) {
        if (e.target === syncPanel) closeSyncPanel();
      });
      syncPanel.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeSyncPanel();
      });
    }
    const btnSyncSaveSettings = $("btnSyncSaveSettings");
    const btnPush = $("btnSyncPush");
    const btnPull = $("btnSyncPull");
    const tokenEye = $("syncTokenEye");
    if (tokenEye) {
      tokenEye.addEventListener("click", function () {
        const input = $("syncToken");
        if (!input) return;
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        tokenEye.setAttribute("aria-label", isPassword ? "隐藏 Token" : "显示 Token");
      });
    }
    if (btnSyncSaveSettings) {
      btnSyncSaveSettings.addEventListener("click", function () {
        const tokenInput = $("syncToken");
        const gistInput = $("syncGistIdBind");
        const token = tokenInput && tokenInput.value.trim();
        const gistId = gistInput && gistInput.value.trim();
        setSyncToken(token || null);
        setGistId(gistId || null);
        if (gistInput) gistInput.value = getGistId() || "";
        updateSyncStatusBar();
        setSyncStatus("已保存");
        startSyncPullInterval();
      });
    }
    if (btnPush) btnPush.addEventListener("click", pushToGist);
    if (btnPull) btnPull.addEventListener("click", function () { pullFromGist({ skipDirtyCheck: true }); });
  }

  async function init() {
    const skeleton = $("mainLoadingSkeleton");
    if (skeleton) skeleton.classList.remove("hidden");
    if (mainPlaceholder) mainPlaceholder.classList.add("hidden");
    if (heatmapCards) heatmapCards.classList.add("hidden");

    load();
    const savedTheme = localStorage.getItem(THEME_KEY);
    applyTheme(savedTheme || "light");
    if (!heatmaps.length) {
      heatmaps = [createHeatmap("示例兴趣", "#216e39")];
      save();
    }
    const hasSyncConfig = getSyncToken() && getGistId();
    console.log("[日迹 sync] 页面加载完成", { hasToken: !!getSyncToken(), hasGistId: !!getGistId(), hasSyncConfig });
    if (hasSyncConfig) {
      const ok = await pullFromGist({ skipDirtyCheck: true });
      if (!ok) {
        lastSyncErrorMessage = "自动拉取失败，请打开「云同步」重试";
        updateSyncStatusText();
      }
    }
    renderAllHeatmaps();
    setupCardDragDrop();
    bindEvents();
    updateSyncStatusText();
    if (skeleton) skeleton.classList.add("hidden");
    const placeholderText = mainPlaceholder ? mainPlaceholder.querySelector("[data-placeholder-text]") : null;
    if (placeholderText) placeholderText.textContent = "点击「新建兴趣」开始记录";
    const placeholderSub = mainPlaceholder ? mainPlaceholder.querySelector("[data-placeholder-sub]") : null;
    if (placeholderSub) placeholderSub.textContent = "点击「新建兴趣」开始记录你的第一个习惯";
    const firstCard = heatmapCards && heatmapCards.querySelector(".heatmap-card");
    if (firstCard && heatmaps.length <= 1) {
      const hint = firstCard.querySelector(".heatmap-hint");
      if (hint) hint.textContent = "点击格子开始记录 · Shift+点击减少 · 长按或右键可减少/清零";
    }
    startSyncPullInterval();
  }

  init();
})();
