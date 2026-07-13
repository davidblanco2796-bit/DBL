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
    pdfPageStage: document.getElementById("pdfPageStage"),
    pinLayer: document.getElementById("pinLayer"),
    clearPinsBtn: document.getElementById("clearPinsBtn"),
    riserPinSync: document.getElementById("riserPinSync"),
    riserPinCount: document.getElementById("riserPinCount"),
    useRiserPinsBtn: document.getElementById("useRiserPinsBtn"),
    fitoutPinSync: document.getElementById("fitoutPinSync"),
    fitoutPinCount: document.getElementById("fitoutPinCount"),
    useFitoutPinsBtn: document.getElementById("useFitoutPinsBtn"),
    complicationPinSync: document.getElementById("complicationPinSync"),
    complicationPinCount: document.getElementById("complicationPinCount"),
    complicationDaysPerPin: document.getElementById("complicationDaysPerPin"),
    useComplicationPinsBtn: document.getElementById("useComplicationPinsBtn"),
    smacnaPressureClass: document.getElementById("smacnaPressureClass"),
    smacnaOutput: document.getElementById("smacnaOutput"),
    scanEndpoint: document.getElementById("scanEndpoint"),
    scanAiBtn: document.getElementById("scanAiBtn"),
    dismissSuggestionsBtn: document.getElementById("dismissSuggestionsBtn"),
    scanStatus: document.getElementById("scanStatus"),
    chatLog: document.getElementById("chatLog"),
    chatEmpty: document.getElementById("chatEmpty"),
    chatForm: document.getElementById("chatForm"),
    chatInput: document.getElementById("chatInput"),
    chatSendBtn: document.getElementById("chatSendBtn"),
  };

  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const RATES = { standard: 3500, prevailing: 4500 };

  // ---- SMACNA reference (HVAC Duct Construction Standards / Air Duct Leakage Test Manual) ----
  // Guidance values, not code text — confirm against the governing project spec / AHJ.
  const SMACNA_TABLE = {
    "0.5": { sealClass: "None mandated", scope: "Sealing not required by SMACNA; Class C recommended for tight systems", targetCL: 30 },
    "1":   { sealClass: "C", scope: "Transverse joints only", targetCL: 24 },
    "2":   { sealClass: "C", scope: "Transverse joints only", targetCL: 12 },
    "3":   { sealClass: "B", scope: "Transverse joints + longitudinal seams", targetCL: 6 },
    "4":   { sealClass: "A", scope: "Transverse joints + longitudinal seams + duct wall penetrations", targetCL: 3 },
    "6":   { sealClass: "A", scope: "Transverse joints + longitudinal seams + duct wall penetrations", targetCL: 3 },
    "10":  { sealClass: "A", scope: "Transverse joints + longitudinal seams + duct wall penetrations", targetCL: 3 },
  };

  function renderSmacna() {
    const pressure = Number(els.smacnaPressureClass.value);
    const row = SMACNA_TABLE[els.smacnaPressureClass.value];
    const leakageRate = row.targetCL * Math.pow(pressure, 0.65);
    els.smacnaOutput.innerHTML = `
      <div class="smacna-row"><span class="k">Required seal class</span><span class="v">${row.sealClass}</span></div>
      <div class="smacna-row"><span class="k">Sealing scope</span><span class="v">${row.scope}</span></div>
      <div class="smacna-row"><span class="k">Target leakage class (CL)</span><span class="v">${row.targetCL}</span></div>
      <div class="smacna-row"><span class="k">Allowable leakage rate</span><span class="v">${leakageRate.toFixed(2)} cfm/100 ft² @ ${pressure}" wg</span></div>
    `;
  }

  els.smacnaPressureClass.addEventListener("change", renderSmacna);

  // ---- Pin markup ----
  const CATEGORY_META = {
    riser: { label: "Riser", code: "R", cssVar: "--series-risers" },
    trunk: { label: "Trunk", code: "T", cssVar: "--series-trunk" },
    branch: { label: "Branch", code: "B", cssVar: "--series-branch" },
    complication: { label: "Complication", code: "C", cssVar: "--series-complications" },
  };

  let pinsByPage = {}; // { [pageNumber]: [{ id, category, xPct, yPct }] }
  let suggestedPinsByPage = {}; // same shape, from AI scan, not yet accepted
  let activeCategory = "riser";
  let lastPdfFileKey = null;

  function allPins() {
    return Object.values(pinsByPage).flat();
  }

  function pinTally() {
    const tally = { riser: 0, trunk: 0, branch: 0, complication: 0 };
    allPins().forEach((p) => { tally[p.category] += 1; });
    return tally;
  }

  function renderPinSync() {
    const tally = pinTally();
    const anyPins = allPins().length > 0;

    els.riserPinSync.hidden = tally.riser === 0;
    els.riserPinCount.textContent = tally.riser;

    const fitoutPins = tally.trunk + tally.branch;
    els.fitoutPinSync.hidden = fitoutPins === 0;
    els.fitoutPinCount.textContent = fitoutPins;

    els.complicationPinSync.hidden = tally.complication === 0;
    els.complicationPinCount.textContent = tally.complication;

    return anyPins;
  }

  function renderPinsOnPage() {
    els.pinLayer.innerHTML = "";
    const pins = pinsByPage[pdfPage] || [];
    const suggestions = suggestedPinsByPage[pdfPage] || [];
    const seen = { riser: 0, trunk: 0, branch: 0, complication: 0 };

    pins.forEach((pin) => {
      seen[pin.category] += 1;
      const meta = CATEGORY_META[pin.category];
      const marker = document.createElement("div");
      marker.className = "pin-marker";
      marker.dataset.category = pin.category;
      marker.style.left = pin.xPct + "%";
      marker.style.top = pin.yPct + "%";
      marker.title = `${meta.label} ${seen[pin.category]} — click to remove`;
      marker.textContent = meta.code + seen[pin.category];
      marker.addEventListener("click", (e) => {
        e.stopPropagation();
        pinsByPage[pdfPage] = pinsByPage[pdfPage].filter((p) => p.id !== pin.id);
        renderPinsOnPage();
      });
      els.pinLayer.appendChild(marker);
    });

    const seenSuggested = { riser: 0, trunk: 0, branch: 0, complication: 0 };
    suggestions.forEach((pin) => {
      seenSuggested[pin.category] += 1;
      const meta = CATEGORY_META[pin.category];
      const marker = document.createElement("div");
      marker.className = "pin-marker suggested";
      marker.dataset.category = pin.category;
      marker.style.left = pin.xPct + "%";
      marker.style.top = pin.yPct + "%";
      const noteSuffix = pin.note ? ` (${pin.note})` : "";
      marker.title = `AI suggestion: ${meta.label}${noteSuffix} — click to accept`;
      marker.textContent = meta.code + "?";
      marker.addEventListener("click", (e) => {
        e.stopPropagation();
        suggestedPinsByPage[pdfPage] = suggestedPinsByPage[pdfPage].filter((p) => p.id !== pin.id);
        if (!pinsByPage[pdfPage]) pinsByPage[pdfPage] = [];
        pinsByPage[pdfPage].push({ id: crypto.randomUUID(), category: pin.category, xPct: pin.xPct, yPct: pin.yPct });
        renderPinsOnPage();
      });
      els.pinLayer.appendChild(marker);
    });

    els.dismissSuggestionsBtn.hidden = suggestions.length === 0;
    renderPinSync();
  }

  document.querySelectorAll(".pin-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      activeCategory = chip.dataset.category;
      document.querySelectorAll(".pin-chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    });
  });

  els.pinLayer.addEventListener("click", (e) => {
    if (!pdfDoc) return;
    const rect = els.pdfPageStage.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    if (!pinsByPage[pdfPage]) pinsByPage[pdfPage] = [];
    pinsByPage[pdfPage].push({
      id: crypto.randomUUID(),
      category: activeCategory,
      xPct: Math.min(99, Math.max(1, xPct)),
      yPct: Math.min(99, Math.max(1, yPct)),
    });
    renderPinsOnPage();
  });

  els.clearPinsBtn.addEventListener("click", () => {
    pinsByPage[pdfPage] = [];
    renderPinsOnPage();
  });

  els.useRiserPinsBtn.addEventListener("click", () => {
    els.riserCount.value = pinTally().riser;
    recalc();
  });

  els.useFitoutPinsBtn.addEventListener("click", () => {
    const t = pinTally();
    els.fitoutCount.value = t.trunk + t.branch;
    recalc();
  });

  els.useComplicationPinsBtn.addEventListener("click", () => {
    const count = pinTally().complication;
    const perPin = Number(els.complicationDaysPerPin.value) || 0;
    els.complicationDays.value = (count * perPin).toFixed(2).replace(/\.?0+$/, "") || "0";
    recalc();
  });

  // ---- AI scan + chat (beta) ----
  const SCAN_ENDPOINT_KEY = "aeroseal_scan_endpoint";
  els.scanEndpoint.value = localStorage.getItem(SCAN_ENDPOINT_KEY) || "";
  els.scanEndpoint.addEventListener("change", () => {
    localStorage.setItem(SCAN_ENDPOINT_KEY, els.scanEndpoint.value.trim());
  });

  function getAiServerBase() {
    return els.scanEndpoint.value.trim().replace(/\/+$/, "");
  }

  els.dismissSuggestionsBtn.addEventListener("click", () => {
    suggestedPinsByPage[pdfPage] = [];
    renderPinsOnPage();
    els.scanStatus.textContent = "";
  });

  els.scanAiBtn.addEventListener("click", async () => {
    if (!pdfDoc) return;
    const base = getAiServerBase();
    if (!base) {
      els.scanStatus.textContent = "Enter your AI server URL first (see server/ in the repo for the beta backend to deploy).";
      return;
    }
    localStorage.setItem(SCAN_ENDPOINT_KEY, base);

    els.scanAiBtn.disabled = true;
    els.scanAiBtn.textContent = "Scanning…";
    els.scanStatus.textContent = `Scanning page ${pdfPage}…`;

    try {
      const image = els.pdfCanvas.toDataURL("image/png");
      const res = await fetch(base + "/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }
      const raw = Array.isArray(data.suggestions) ? data.suggestions : [];
      const clean = raw
        .filter((s) => Number.isFinite(s.xPct) && Number.isFinite(s.yPct))
        .map((s) => ({
          id: crypto.randomUUID(),
          category: CATEGORY_META[s.category] ? s.category : "trunk",
          xPct: Math.min(99, Math.max(1, s.xPct)),
          yPct: Math.min(99, Math.max(1, s.yPct)),
          note: typeof s.note === "string" ? s.note.slice(0, 80) : "",
        }));

      suggestedPinsByPage[pdfPage] = clean;
      renderPinsOnPage();
      els.scanStatus.textContent = clean.length
        ? `${clean.length} AI suggestion(s) on this page — click one to accept, or Dismiss suggestions.`
        : "No suggestions found on this page.";
    } catch (err) {
      els.scanStatus.textContent = `Scan failed: ${err.message}`;
    } finally {
      els.scanAiBtn.disabled = false;
      els.scanAiBtn.textContent = "Scan with AI (beta)";
    }
  });

  // ---- Chat about this page (beta) ----
  let chatHistory = []; // [{ role: 'user'|'assistant', content: string }]

  function appendChatBubble(role, text) {
    els.chatEmpty.hidden = true;
    const bubble = document.createElement("div");
    bubble.className = `chat-msg chat-msg-${role}`;
    bubble.textContent = text;
    els.chatLog.appendChild(bubble);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
    return bubble;
  }

  els.chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const question = els.chatInput.value.trim();
    if (!question) return;

    if (!pdfDoc) {
      appendChatBubble("error", "Upload a plan PDF first — the chat answers about whichever page is on screen.");
      return;
    }
    const base = getAiServerBase();
    if (!base) {
      appendChatBubble("error", "Enter your AI server URL first (see server/ in the repo for the beta backend to deploy).");
      return;
    }
    localStorage.setItem(SCAN_ENDPOINT_KEY, base);

    appendChatBubble("user", question);
    chatHistory.push({ role: "user", content: question });
    els.chatInput.value = "";
    els.chatInput.disabled = true;
    els.chatSendBtn.disabled = true;
    const pending = appendChatBubble("pending", "Thinking…");

    try {
      const image = els.pdfCanvas.toDataURL("image/png");
      const res = await fetch(base + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, messages: chatHistory }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }
      const reply = typeof data.reply === "string" && data.reply ? data.reply : "(no reply)";
      pending.remove();
      appendChatBubble("assistant", reply);
      chatHistory.push({ role: "assistant", content: reply });
    } catch (err) {
      pending.remove();
      appendChatBubble("error", `Chat failed: ${err.message}`);
      chatHistory.pop(); // drop the unanswered question so a retry doesn't duplicate it
    } finally {
      els.chatInput.disabled = false;
      els.chatSendBtn.disabled = false;
      els.chatInput.focus();
    }
  });

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
    if (job.smacnaPressureClass) els.smacnaPressureClass.value = job.smacnaPressureClass;
    renderSmacna();
    pinsByPage = job.pinsByPage ? JSON.parse(JSON.stringify(job.pinsByPage)) : {};
    suggestedPinsByPage = {};
    lastPdfFileKey = null;
    renderPinsOnPage();
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
    const job = {
      id: crypto.randomUUID(),
      savedAt: Date.now(),
      ...state,
      estimate,
      smacnaPressureClass: els.smacnaPressureClass.value,
      pinsByPage,
    };
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
    renderPinsOnPage();
  }

  els.pdfInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    els.pdfFileName.textContent = file.name;

    const fileKey = `${file.name}:${file.size}`;
    if (lastPdfFileKey !== null && fileKey !== lastPdfFileKey) {
      pinsByPage = {};
      suggestedPinsByPage = {};
    }
    lastPdfFileKey = fileKey;

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
  renderSmacna();
  renderPinSync();
})();
