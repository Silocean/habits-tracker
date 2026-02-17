(function () {
  const STORAGE_KEY = "habits-tracker-heatmaps";
  const SYNC_TOKEN_KEY = "habits-tracker-sync-token";
  const GIST_ID_KEY = "habits-tracker-gist-id";
  const GIST_FILENAME = "habits-tracker.json";
  const GIST_API = "https://api.github.com/gists";
  const WEEKS = 53;
  const DAYS_PER_WEEK = 7;
  const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
  const CELL_PX = 16;
  const GAP_PX = 5;

  let heatmaps = [];

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
    } catch (_) {
      heatmaps = [];
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(heatmaps));
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
    };
  }

  function getYearOptions() {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = currentYear; y >= currentYear - 10; y--) years.push(y);
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
        monthStarts.push({ col, label: (month + 1) + "月" });
        lastMonth = month;
      }
    }
    return monthStarts
      .map(
        ({ col, label }) =>
          `<span class="heatmap-month-label" style="left: ${col * (CELL_PX + GAP_PX)}px">${escapeHtml(label)}</span>`
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

    const yearOptions = getYearOptions();
    const rangeValue = viewRange === "recent" || viewRange == null ? "recent" : String(viewRange);
    const rangeOptions =
      '<option value="recent">最近一年</option>' +
      yearOptions.map((y) => `<option value="${y}" ${rangeValue === String(y) ? "selected" : ""}>${y} 年</option>`).join("");

    const card = document.createElement("div");
    card.className = "heatmap-card";
    card.id = "card-" + heatmap.id;
    card.dataset.heatmapId = heatmap.id;

    const wrap = document.createElement("div");
    wrap.className = "heatmap-wrap";

    const header = document.createElement("header");
    header.className = "heatmap-header";
    const displayName = heatmap.name || "未命名兴趣";
    header.innerHTML =
      '<div class="heatmap-title-wrap">' +
      `<span class="heatmap-title-display" title="点击修改">${escapeHtml(displayName)}</span>` +
      `<input type="text" class="heatmap-title heatmap-title-edit hidden" placeholder="未命名兴趣" maxlength="32" value="${escapeHtml(heatmap.name)}" />` +
      "</div>" +
      '<div class="header-actions">' +
      '<label class="range-label"><span>时间范围</span><select class="range-select">' +
      rangeOptions +
      "</select></label>" +
      '<label class="color-label"><span>颜色</span><div class="color-picker-wrap"></div></label>' +
      '<button type="button" class="btn btn-ghost btn-delete">删除</button>' +
      "</div>";

    const statsDiv = document.createElement("div");
    statsDiv.className = "heatmap-stats";
    function updateStatsDom() {
      const s = getHeatmapStats(heatmap, heatmap.viewRange == null ? "recent" : heatmap.viewRange);
      statsDiv.innerHTML =
        `总 <strong>${s.total}</strong> 次 · 最长连续 <strong>${s.streakDays}</strong> 天 · 日均 <strong>${s.avgPerDay.toFixed(2)}</strong> 次`;
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
    }

    const todayKey = formatDateKey(new Date());
    const isYearView = typeof viewRange === "number";
    gridDates.forEach(({ date, row, col, inYear }) => {
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

      cell.addEventListener("click", (e) => {
        if (showAsEmpty) return;
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

      cell.addEventListener("mouseenter", (e) => showTooltip(e, key, () => e.target.dataset.count));
      cell.addEventListener("mouseleave", hideTooltip);
      grid.appendChild(cell);
    });

    gridWrap.appendChild(months);
    gridWrap.appendChild(grid);
    container.appendChild(weekdays);
    container.appendChild(gridWrap);

    scrollHeatmapToToday(gridWrap, grid, todayKey, gridDates);

    const hint = document.createElement("p");
    hint.className = "heatmap-hint";
    hint.textContent = "点击增加 · Shift+点击减少 · 右键菜单可清零";
    wrap.appendChild(header);
    wrap.appendChild(statsDiv);
    wrap.appendChild(legendDiv);
    wrap.appendChild(container);
    wrap.appendChild(hint);
    card.appendChild(wrap);

    const titleDisplay = header.querySelector(".heatmap-title-display");
    const titleInput = header.querySelector(".heatmap-title");
    const rangeSelect = header.querySelector(".range-select");
    const colorPickerWrap = header.querySelector(".color-picker-wrap");
    const deleteBtn = header.querySelector(".btn-delete");

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

    rangeSelect.addEventListener("change", function () {
      const v = this.value;
      heatmap.viewRange = v === "recent" ? "recent" : parseInt(v, 10);
      save();
      renderAllHeatmaps();
    });

    (function setupColorPicker() {
      const rgb = hexToRgb(heatmap.color);
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "color-swatch";
      swatch.style.background = heatmap.color;
      swatch.setAttribute("aria-label", "选择颜色");
      const dropdown = document.createElement("div");
      dropdown.className = "color-picker-dropdown hidden";
      dropdown.innerHTML =
        '<div class="color-picker-row"><span>R</span><input type="range" min="0" max="255" class="color-range color-r"></div>' +
        '<div class="color-picker-row"><span>G</span><input type="range" min="0" max="255" class="color-range color-g"></div>' +
        '<div class="color-picker-row"><span>B</span><input type="range" min="0" max="255" class="color-range color-b"></div>' +
        '<div class="color-picker-row"><span>#</span><input type="text" class="color-hex" maxlength="7" placeholder="#000000"></div>';
      const rInput = dropdown.querySelector(".color-r");
      const gInput = dropdown.querySelector(".color-g");
      const bInput = dropdown.querySelector(".color-b");
      const hexInput = dropdown.querySelector(".color-hex");
      rInput.value = rgb.r;
      gInput.value = rgb.g;
      bInput.value = rgb.b;
      hexInput.value = heatmap.color;

      function applyColor(hex) {
        hex = hex.startsWith("#") ? hex : "#" + hex;
        if (!/^#[0-f]{6}$/i.test(hex)) return;
        heatmap.color = hex;
        save();
        swatch.style.background = hex;
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

      swatch.addEventListener("click", function (e) {
        e.stopPropagation();
        const open = document.querySelector(".color-picker-dropdown:not(.hidden)");
        if (open && open !== dropdown) open.classList.add("hidden");
        dropdown.classList.toggle("hidden");
      });
      document.addEventListener("click", function closePicker(e) {
        if (dropdown.classList.contains("hidden")) return;
        if (!colorPickerWrap.contains(e.target)) {
          dropdown.classList.add("hidden");
        }
      });

      colorPickerWrap.appendChild(swatch);
      colorPickerWrap.appendChild(dropdown);
    })();

    deleteBtn.addEventListener("click", function () {
      if (!confirm("确定要删除这个兴趣记录吗？")) return;
      const idx = getHeatmapIndex(heatmap.id);
      if (idx === -1) return;
      heatmaps.splice(idx, 1);
      save();
      renderAllHeatmaps();
    });

    return card;
  }

  function renderAllHeatmaps() {
    heatmapCards.innerHTML = "";
    if (heatmaps.length === 0) {
      mainPlaceholder.classList.remove("hidden");
      heatmapCards.classList.add("hidden");
      return;
    }
    mainPlaceholder.classList.add("hidden");
    heatmapCards.classList.remove("hidden");
    heatmaps.forEach((h) => heatmapCards.appendChild(renderHeatmapCard(h)));
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

  async function pushToGist() {
    const token = ($("syncToken") && $("syncToken").value.trim()) || getSyncToken();
    if (!token) {
      setSyncStatus("请先填写并保存 Token", true);
      return;
    }
    setSyncStatus("推送中…");
    const gistId = getGistId();
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
      if (!res.ok) {
        setSyncStatus(data.message || "推送失败 " + res.status, true);
        return;
      }
      if (data.id) {
        setGistId(data.id);
        const gistDisplay = $("syncGistIdDisplay");
        if (gistDisplay) gistDisplay.value = data.id;
      }
      setSyncStatus("已推送到云端 " + new Date().toLocaleTimeString("zh-CN"));
    } catch (err) {
      setSyncStatus("网络错误：" + (err.message || "未知"), true);
    }
  }

  async function pullFromGist() {
    const token = ($("syncToken") && $("syncToken").value.trim()) || getSyncToken();
    const gistId = getGistId();
    if (!token) {
      setSyncStatus("请先填写并保存 Token", true);
      return;
    }
    if (!gistId) {
      setSyncStatus("请先执行一次「推送到云端」以创建 Gist", true);
      return;
    }
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
        setSyncStatus(data.message || "拉取失败 " + res.status, true);
        return;
      }
      const file = data.files && data.files[GIST_FILENAME];
      if (!file || file.content == null) {
        setSyncStatus("Gist 中未找到 " + GIST_FILENAME, true);
        return;
      }
      const parsed = JSON.parse(file.content);
      if (!Array.isArray(parsed)) {
        setSyncStatus("数据格式无效", true);
        return;
      }
      heatmaps = parsed;
      save();
      renderAllHeatmaps();
      setSyncStatus("已从云端拉取 " + new Date().toLocaleTimeString("zh-CN"));
    } catch (err) {
      setSyncStatus("网络错误：" + (err.message || "未知"), true);
    }
  }

  function openSyncPanel() {
    const panel = $("syncPanel");
    const tokenInput = $("syncToken");
    const gistDisplay = $("syncGistIdDisplay");
    const gistBind = $("syncGistIdBind");
    if (panel) panel.classList.remove("hidden");
    if (tokenInput && getSyncToken()) tokenInput.placeholder = "已保存（留空不修改）";
    if (gistDisplay) gistDisplay.value = getGistId() || "";
    if (gistBind) gistBind.value = "";
  }
  function closeSyncPanel() {
    const panel = $("syncPanel");
    if (panel) panel.classList.add("hidden");
  }

  function bindEvents() {
    $("btnNew").addEventListener("click", addNewHeatmap);

    const btnSync = $("btnSync");
    const syncPanel = $("syncPanel");
    const syncClose = $("syncClose");
    if (btnSync) btnSync.addEventListener("click", openSyncPanel);
    if (syncClose) syncClose.addEventListener("click", closeSyncPanel);
    if (syncPanel) {
      syncPanel.addEventListener("click", function (e) {
        if (e.target === syncPanel) closeSyncPanel();
      });
    }
    const btnSaveToken = $("btnSyncSaveToken");
    const btnPush = $("btnSyncPush");
    const btnPull = $("btnSyncPull");
    if (btnSaveToken) {
      btnSaveToken.addEventListener("click", function () {
        const input = $("syncToken");
        const v = input && input.value.trim();
        setSyncToken(v || null);
        setSyncStatus(v ? "Token 已保存" : "Token 已清除");
      });
    }
    const btnBindGist = $("btnSyncBindGist");
    if (btnBindGist) {
      btnBindGist.addEventListener("click", function () {
        const input = $("syncGistIdBind");
        const id = input && input.value.trim();
        if (!id) {
          setSyncStatus("请先粘贴 Gist ID", true);
          return;
        }
        setGistId(id);
        if (input) input.value = "";
        const gistDisplay = $("syncGistIdDisplay");
        if (gistDisplay) gistDisplay.value = id;
        setSyncStatus("已绑定 Gist，可点击「从云端拉取」");
      });
    }
    if (btnPush) btnPush.addEventListener("click", pushToGist);
    if (btnPull) btnPull.addEventListener("click", pullFromGist);
  }

  function init() {
    load();
    if (!heatmaps.length) {
      heatmaps = [createHeatmap("示例兴趣", "#216e39")];
      save();
    }
    renderAllHeatmaps();
    bindEvents();
  }

  init();
})();
