(function () {
  "use strict";

  const STORAGE_KEY = "aeroseal_jobs";

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
  }

  const els = {
    jobName: document.getElementById("jobName"),
    riserCount: document.getElementById("riserCount"),
    riserPace: document.getElementById("riserPace"),
    fitoutCount: document.getElementById("fitoutCount"),
    fitoutPace: document.getElementById("fitoutPace"),
    complicationDays: document.getElementById("complicationDays"),
    complicationNote: document.getElementById("complicationNote"),
    customRateField: document.getElementById("customRateField"),
    customRateValue: document.getElementById("customRateValue"),
    statDays: document.getElementById("statDays"),
    statDaysRaw: document.getElementById("statDaysRaw"),
    statPrice: document.getElementById("statPrice"),
    breakdownBar: document.getElementById("breakdownBar"),
    breakdownLegend: document.getElementById("breakdownLegend"),
    saveJobBtn: document.getElementById("saveJobBtn"),
    saveStatus: document.getElementById("saveStatus"),
    savedList: document.getElementById("savedList"),
    pdfInput: document.getElementById("pdfInput"),
    pdfFileName: document.getElementById("pdfFileName"),
    pdfViewer: document.getElementById("pdfViewer"),
    pdfCanvas: document.getElementById("pdfCanvas"),
    pdfPageIndicator: document.getElementById("pdfPageIndicator"),
    pdfPrev: document.getElementById("pdfPrev"),
    pdfNext: document.getElementById("pdfNext"),
    pdfZoomIn: document.getElementById("pdfZoomIn"),
    pdfZoomOut: document.getElementById("pdfZoomOut"),
  };

  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const RATES = { standard: 3500, prevailing: 4500 };

  function getDayRate() {
    const mode = document.querySelector('input[name="dayRate"]:checked').value;
    if (mode === "custom") return Number(els.customRateValue.value) || 0;
    return RATES[mode];
  }

  function num(el) {
    const v = Number(el.value);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }

  function computeEstimate(state) {
    const riserDays = state.riserCount > 0 && state.riserPace > 0 ? state.riserCount / state.riserPace : 0;
    const fitoutDays = state.fitoutCount > 0 && state.fitoutPace > 0 ? state.fitoutCount / state.fitoutPace : 0;
    const complicationDays = state.complicationDays;
    const rawDays = riserDays + fitoutDays + complicationDays;
    const billedDays = Math.ceil(rawDays) || (rawDays > 0 ? 1 : 0);
    const totalPrice = billedDays * state.dayRate;
    return { riserDays, fitoutDays, complicationDays, rawDays, billedDays, totalPrice };
  }

  function readState() {
    return {
      riserCount: num(els.riserCount),
      riserPace: num(els.riserPace),
      fitoutCount: num(els.fitoutCount),
      fitoutPace: num(els.fitoutPace),
      complicationDays: num(els.complicationDays),
      complicationNote: els.complicationNote.value.trim(),
      dayRateMode: document.querySelector('input[name="dayRate"]:checked').value,
      dayRate: getDayRate(),
      jobName: els.jobName.value.trim(),
    };
  }

  const SEGMENTS = [
    { key: "riserDays", label: "Risers", cssVar: "--series-risers" },
    { key: "fitoutDays", label: "Horizontal fitouts", cssVar: "--series-fitouts" },
    { key: "complicationDays", label: "Complications", cssVar: "--series-complications" },
  ];

  function renderBreakdown(estimate) {
    els.breakdownBar.innerHTML = "";
    els.breakdownLegend.innerHTML = "";

    const total = estimate.rawDays;

    if (total <= 0) {
      els.breakdownBar.style.background = "var(--gridline)";
      const li = document.createElement("li");
      li.className = "empty-state";
      li.textContent = "Enter counts above to see the crew-day breakdown.";
      els.breakdownLegend.appendChild(li);
      return;
    }

    SEGMENTS.forEach((seg) => {
      const days = estimate[seg.key];
      if (days <= 0) return;
      const pct = (days / total) * 100;

      const segEl = document.createElement("div");
      segEl.className = "segment";
      segEl.style.width = pct + "%";
      segEl.style.background = `var(${seg.cssVar})`;
      segEl.tabIndex = 0;

      const tooltip = document.createElement("span");
      tooltip.className = "tooltip";
      tooltip.textContent = `${seg.label}: ${days.toFixed(1)}d (${pct.toFixed(0)}%)`;
      segEl.appendChild(tooltip);

      els.breakdownBar.appendChild(segEl);

      const li = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = `var(${seg.cssVar})`;
      const name = document.createElement("span");
      name.className = "legend-name";
      name.textContent = seg.label;
      const value = document.createElement("span");
      value.className = "legend-value";
      value.textContent = `${days.toFixed(1)}d · ${pct.toFixed(0)}%`;
      li.appendChild(swatch);
      li.appendChild(name);
      li.appendChild(value);
      els.breakdownLegend.appendChild(li);
    });
  }

  function recalc() {
    const state = readState();
    const estimate = computeEstimate(state);

    els.statDays.textContent = estimate.billedDays.toFixed(0);
    els.statDaysRaw.textContent =
      estimate.rawDays > 0 ? `${estimate.rawDays.toFixed(1)}d raw, rounded up to full days` : "";
    els.statPrice.textContent = currency.format(estimate.totalPrice);

    renderBreakdown(estimate);
    return { state, estimate };
  }

  // ---- Day rate toggle ----
  document.querySelectorAll('input[name="dayRate"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      els.customRateField.hidden = radio.value !== "custom" || !radio.checked;
      if (document.querySelector('input[name="dayRate"]:checked').value === "custom") {
        els.customRateField.hidden = false;
      }
      recalc();
    });
  });

  // ---- Live recalculation ----
  [
    els.riserCount, els.riserPace,
    els.fitoutCount, els.fitoutPace,
    els.complicationDays, els.customRateValue,
  ].forEach((el) => el.addEventListener("input", recalc));

  // ---- Saved jobs ----
  function loadJobs() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }

  function persistJobs(jobs) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  }

  function renderSavedJobs() {
    const jobs = loadJobs().sort((a, b) => b.savedAt - a.savedAt);
    els.savedList.innerHTML = "";

    if (jobs.length === 0) {
      const li = document.createElement("li");
      li.className = "empty-state";
      li.textContent = "No saved jobs yet.";
      els.savedList.appendChild(li);
      return;
    }

    jobs.forEach((job) => {
      const li = document.createElement("li");
      li.className = "saved-item";

      const info = document.createElement("div");
      info.className = "saved-item-info";
      const name = document.createElement("div");
      name.className = "saved-item-name";
      name.textContent = job.jobName || "Untitled job";
      const meta = document.createElement("div");
      meta.className = "saved-item-meta";
      const date = new Date(job.savedAt).toLocaleDateString();
      meta.textContent = `${date} · ${job.estimate.billedDays.toFixed(0)}d · ${currency.format(job.estimate.totalPrice)}`;
      info.appendChild(name);
      info.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "saved-item-actions";

      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "btn btn-secondary";
      loadBtn.textContent = "Load";
      loadBtn.addEventListener("click", () => applyJob(job));

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-ghost";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        persistJobs(loadJobs().filter((j) => j.id !== job.id));
        renderSavedJobs();
      });

      actions.appendChild(loadBtn);
      actions.appendChild(deleteBtn);

      li.appendChild(info);
      li.appendChild(actions);
      els.savedList.appendChild(li);
    });
  }

  function applyJob(job) {
    els.jobName.value = job.jobName || "";
    els.riserCount.value = job.riserCount;
    els.riserPace.value = job.riserPace;
    els.fitoutCount.value = job.fitoutCount;
    els.fitoutPace.value = job.fitoutPace;
    els.complicationDays.value = job.complicationDays;
    els.complicationNote.value = job.complicationNote || "";
    const radio = document.querySelector(`input[name="dayRate"][value="${job.dayRateMode}"]`);
    if (radio) radio.checked = true;
    els.customRateField.hidden = job.dayRateMode !== "custom";
    if (job.dayRateMode === "custom") els.customRateValue.value = job.dayRate;
    recalc();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  els.saveJobBtn.addEventListener("click", () => {
    const { state, estimate } = recalc();
    if (!state.jobName) {
      els.jobName.focus();
      els.saveStatus.textContent = "Add a job name first.";
      setTimeout(() => (els.saveStatus.textContent = ""), 2500);
      return;
    }
    const job = { id: crypto.randomUUID(), savedAt: Date.now(), ...state, estimate };
    const jobs = loadJobs();
    jobs.push(job);
    persistJobs(jobs);
    renderSavedJobs();
    els.saveStatus.textContent = "Saved.";
    setTimeout(() => (els.saveStatus.textContent = ""), 2000);
  });

  // ---- PDF viewer ----
  let pdfDoc = null;
  let pdfPage = 1;
  let pdfScale = 1.2;

  async function renderPdfPage() {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(pdfPage);
    const viewport = page.getViewport({ scale: pdfScale });
    const canvas = els.pdfCanvas;
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    els.pdfPageIndicator.textContent = `Page ${pdfPage} / ${pdfDoc.numPages}`;
  }

  els.pdfInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    els.pdfFileName.textContent = file.name;

    const buf = await file.arrayBuffer();
    pdfDoc = await window.pdfjsLib.getDocument({ data: buf }).promise;
    pdfPage = 1;
    els.pdfViewer.hidden = false;
    await renderPdfPage();
  });

  els.pdfPrev.addEventListener("click", () => {
    if (!pdfDoc || pdfPage <= 1) return;
    pdfPage -= 1;
    renderPdfPage();
  });

  els.pdfNext.addEventListener("click", () => {
    if (!pdfDoc || pdfPage >= pdfDoc.numPages) return;
    pdfPage += 1;
    renderPdfPage();
  });

  els.pdfZoomIn.addEventListener("click", () => {
    pdfScale = Math.min(pdfScale + 0.2, 3);
    renderPdfPage();
  });

  els.pdfZoomOut.addEventListener("click", () => {
    pdfScale = Math.max(pdfScale - 0.2, 0.4);
    renderPdfPage();
  });

  // ---- init ----
  recalc();
  renderSavedJobs();
})();
