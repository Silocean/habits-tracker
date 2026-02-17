(function () {
  const STORAGE_KEY = "habits-tracker-heatmaps";
  const WEEKS = 53;
  const DAYS_PER_WEEK = 7;
  const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
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

  function getWeekStart(d) {
    const day = d.getDay();
    const diff = d.getDate() - day;
    const sunday = new Date(d);
    sunday.setDate(diff);
    sunday.setHours(0, 0, 0, 0);
    return sunday;
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
      viewRange: "recent",
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
    const rect = e.target.getBoundingClientRect();
    tooltipEl.style.left = rect.left + rect.width / 2 - tooltipEl.offsetWidth / 2 + "px";
    tooltipEl.style.top = rect.top - tooltipEl.offsetHeight - 8 + "px";
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
      '<label class="color-label"><span>颜色</span><input type="color" class="color-input" value="' +
      escapeHtml(heatmap.color) +
      '" /></label>' +
      '<button type="button" class="btn btn-ghost btn-delete">删除</button>' +
      "</div>";

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
      cell.dataset.count = newCount;
      const newLevel = getLevel(newCount);
      const isToday = cell.dataset.isToday === "1";
      cell.className = "heatmap-cell level-" + newLevel + (inYear ? "" : " outside-year") + (isToday ? " heatmap-cell-today" : "");
      if (newLevel === 0) {
        cell.classList.add("empty");
        cell.style.background = "";
      } else {
        cell.style.background = colors[newLevel];
      }
      refreshTooltipForCell(cell);
    }

    const todayKey = formatDateKey(new Date());
    gridDates.forEach(({ date, row, col, inYear }) => {
      const key = formatDateKey(date);
      const isToday = key === todayKey;
      const count = heatmap.data[key] || 0;
      const level = getLevel(count);
      const cell = document.createElement("div");
      cell.className = "heatmap-cell level-" + level + (inYear ? "" : " outside-year") + (isToday ? " heatmap-cell-today" : "");
      cell.style.background = level === 0 ? "" : colors[level];
      if (level === 0) cell.classList.add("empty");
      cell.dataset.key = key;
      cell.dataset.count = count;
      cell.dataset.inYear = inYear ? "1" : "0";
      cell.dataset.isToday = isToday ? "1" : "0";
      cell.setAttribute("aria-label", `${key} ${count}次${isToday ? "（今天）" : ""}`);

      cell.addEventListener("click", (e) => {
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
    wrap.appendChild(legendDiv);
    wrap.appendChild(container);
    wrap.appendChild(hint);
    card.appendChild(wrap);

    const titleDisplay = header.querySelector(".heatmap-title-display");
    const titleInput = header.querySelector(".heatmap-title");
    const rangeSelect = header.querySelector(".range-select");
    const colorInput = header.querySelector(".color-input");
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

    colorInput.addEventListener("input", function () {
      heatmap.color = this.value;
      save();
      renderAllHeatmaps();
    });

    deleteBtn.addEventListener("click", function () {
      if (!confirm("确定要删除这个兴趣记录吗？")) return;
      const idx = getHeatmapIndex(heatmap.id);
      if (idx === -1) return;
      heatmaps.splice(idx, 1);
      save();
      renderAllHeatmaps();
      renderList();
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

  function bindEvents() {
    $("btnNew").addEventListener("click", addNewHeatmap);
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
