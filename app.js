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
    exportAllBtn: document.getElementById("exportAllBtn"),
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

  const DAY_RATE_LABELS = { standard: "Standard", prevailing: "Prevailing wage", custom: "Custom" };

  // Splits the job's total price into billing line items, allocated by each
  // category's share of raw crew days — the same math the breakdown bar
  // uses — since the day-rate model has no real per-riser/per-run price to
  // report. Amounts always sum back to the exact total price.
  function jobLineItems(job) {
    const tally = job.pinTally || { riser: 0, trunk: 0, branch: 0, complication: 0 };
    const rawDays = job.estimate.rawDays;
    const totalPrice = job.estimate.totalPrice;
    const allocate = (days) => (rawDays > 0 ? (days / rawDays) * totalPrice : 0);
    const items = [];

    if (job.riserCount > 0) {
      const riserDays = job.riserPace > 0 ? job.riserCount / job.riserPace : 0;
      const amount = allocate(riserDays);
      items.push({
        item: "Risers",
        description: `${job.riserCount} riser${job.riserCount === 1 ? "" : "s"} @ ${job.riserPace}/day`,
        qty: job.riserCount,
        rate: amount / job.riserCount,
        amount,
      });
    }

    if (job.fitoutCount > 0) {
      const fitoutDays = job.fitoutPace > 0 ? job.fitoutCount / job.fitoutPace : 0;
      const fitoutAmount = allocate(fitoutDays);
      const pinnedFitouts = tally.trunk + tally.branch;
      if (pinnedFitouts > 0) {
        if (tally.trunk > 0) {
          const amount = fitoutAmount * (tally.trunk / pinnedFitouts);
          items.push({
            item: "Trunk duct",
            description: `${tally.trunk} trunk run${tally.trunk === 1 ? "" : "s"} pinned on drawing`,
            qty: tally.trunk,
            rate: amount / tally.trunk,
            amount,
          });
        }
        if (tally.branch > 0) {
          const amount = fitoutAmount * (tally.branch / pinnedFitouts);
          items.push({
            item: "Branch duct",
            description: `${tally.branch} branch run${tally.branch === 1 ? "" : "s"} pinned on drawing`,
            qty: tally.branch,
            rate: amount / tally.branch,
            amount,
          });
        }
      } else {
        items.push({
          item: "Horizontal fitouts",
          description: `${job.fitoutCount} @ ${job.fitoutPace}/day`,
          qty: job.fitoutCount,
          rate: fitoutAmount / job.fitoutCount,
          amount: fitoutAmount,
        });
      }
    }

    if (job.complicationDays > 0) {
      const amount = allocate(job.complicationDays);
      items.push({
        item: "Complications",
        description: job.complicationNote || "Extra days (access, flat oval/lined duct, etc.)",
        qty: job.complicationDays,
        rate: amount / job.complicationDays,
        amount,
      });
    }

    if (items.length === 0) {
      items.push({ item: "Aeroseal Duct Sealing", description: "", qty: 1, rate: totalPrice, amount: totalPrice });
    }

    return items;
  }

  function jobContextLines(job) {
    const smacna = SMACNA_TABLE[job.smacnaPressureClass];
    return [
      `Day rate: ${DAY_RATE_LABELS[job.dayRateMode] || job.dayRateMode} (${currency.format(job.dayRate)}/day)`,
      smacna
        ? `SMACNA: ${job.smacnaPressureClass}" wg — Seal Class ${smacna.sealClass}, target leakage class ${smacna.targetCL}`
        : null,
      `Crew days: ${job.estimate.billedDays} billed (${job.estimate.rawDays.toFixed(1)} raw)`,
    ].filter(Boolean);
  }

  function summarizeJobLines(job) {
    return [
      `Job: ${job.jobName || "Untitled job"}`,
      `Date: ${new Date(job.savedAt).toLocaleDateString()}`,
      ...jobLineItems(job).map(
        (li) => `${li.item}: ${li.qty} — ${currency.format(li.rate)} ea — ${currency.format(li.amount)}${li.description ? ` (${li.description})` : ""}`
      ),
      ...jobContextLines(job),
      `Total price: ${currency.format(job.estimate.totalPrice)}`,
    ];
  }

  function csvEscape(value) {
    const s = String(value ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function jobToCsvRows(job) {
    const customer = job.jobName || "Untitled job";
    const date = new Date(job.savedAt).toISOString().slice(0, 10);
    return jobLineItems(job).map((li) => [
      customer,
      date,
      li.item,
      li.description,
      li.qty,
      li.rate.toFixed(2),
      li.amount.toFixed(2),
    ]);
  }

  function downloadCsv(filename, rows) {
    const content = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const CSV_HEADER = ["Customer", "Date", "Item", "Description", "Qty", "Rate", "Amount"];

  els.exportAllBtn.addEventListener("click", () => {
    const jobs = loadJobs().sort((a, b) => b.savedAt - a.savedAt);
    if (jobs.length === 0) return;
    downloadCsv("aeroseal-jobs.csv", [CSV_HEADER, ...jobs.flatMap(jobToCsvRows)]);
  });

  function renderSavedJobs() {
    const jobs = loadJobs().sort((a, b) => b.savedAt - a.savedAt);
    els.savedList.innerHTML = "";
    els.exportAllBtn.hidden = jobs.length === 0;

    if (jobs.length === 0) {
      const li = document.createElement("li");
      li.className = "empty-state";
      li.textContent = "No saved jobs yet.";
      els.savedList.appendChild(li);
      return;
    }

    jobs.forEach((job) => {
      const tally = job.pinTally || { riser: 0, trunk: 0, branch: 0, complication: 0 };
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
      const counts = document.createElement("div");
      counts.className = "saved-item-counts";
      counts.textContent = `Risers ${job.riserCount} · Trunk ${tally.trunk} · Branch ${tally.branch} · Fitouts ${job.fitoutCount}`;
      info.appendChild(name);
      info.appendChild(meta);
      info.appendChild(counts);

      const details = document.createElement("div");
      details.className = "saved-item-details";
      details.hidden = true;

      function tableRow(tag, cells) {
        const tr = document.createElement("tr");
        cells.forEach(([text, colspan]) => {
          const cell = document.createElement(tag);
          cell.textContent = text;
          if (colspan) cell.colSpan = colspan;
          tr.appendChild(cell);
        });
        return tr;
      }

      const table = document.createElement("table");
      table.className = "line-items-table";
      const thead = document.createElement("thead");
      thead.appendChild(tableRow("th", [["Item"], ["Qty"], ["Rate"], ["Amount"]]));
      const tbody = document.createElement("tbody");
      jobLineItems(job).forEach((li) => {
        const label = li.description ? `${li.item} — ${li.description}` : li.item;
        tbody.appendChild(
          tableRow("td", [[label], [String(li.qty)], [currency.format(li.rate)], [currency.format(li.amount)]])
        );
      });
      const tfoot = document.createElement("tfoot");
      tfoot.appendChild(tableRow("td", [["Total", 3], [currency.format(job.estimate.totalPrice)]]));
      table.appendChild(thead);
      table.appendChild(tbody);
      table.appendChild(tfoot);
      details.appendChild(table);

      jobContextLines(job).forEach((line) => {
        const p = document.createElement("div");
        p.className = "saved-item-context-line";
        p.textContent = line;
        details.appendChild(p);
      });
      info.appendChild(details);

      const actions = document.createElement("div");
      actions.className = "saved-item-actions";

      const detailsBtn = document.createElement("button");
      detailsBtn.type = "button";
      detailsBtn.className = "btn btn-ghost";
      detailsBtn.textContent = "Details";
      detailsBtn.addEventListener("click", () => {
        details.hidden = !details.hidden;
        detailsBtn.textContent = details.hidden ? "Details" : "Hide details";
      });

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn btn-ghost";
      copyBtn.textContent = "Copy summary";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(summarizeJobLines(job).join("\n"));
          copyBtn.textContent = "Copied!";
        } catch {
          copyBtn.textContent = "Copy failed";
        }
        setTimeout(() => (copyBtn.textContent = "Copy summary"), 1500);
      });

      const csvBtn = document.createElement("button");
      csvBtn.type = "button";
      csvBtn.className = "btn btn-secondary";
      csvBtn.textContent = "Export CSV";
      csvBtn.addEventListener("click", () => {
        const safeName = (job.jobName || "job").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
        downloadCsv(`aeroseal-${safeName}.csv`, [CSV_HEADER, ...jobToCsvRows(job)]);
      });

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

      actions.appendChild(detailsBtn);
      actions.appendChild(copyBtn);
      actions.appendChild(csvBtn);
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
      pinTally: pinTally(),
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
