/* CODEX STUDYS — Sarvam batches (Career Institute + Crash Course)
 * Data lives in sarvam-data.json (decoded 1:1 from the two source pages).
 * This module plugs into the existing app.js architecture:
 *   - cards()   -> light batch objects merged into allBatches (native cards, filters, favourites)
 *   - searchText() -> deep search index used by app.js deepSearchText()
 *   - open()    -> batch view (Lectures / Modules / Practice / Mock Tests) + one HLS player
 */
(function () {
  "use strict";

  const DATA_URL = "sarvam-data.json";
  const CATEGORY = "sarvam";
  const CATEGORY_LABEL = "Sarvam";
  const HLS_SRC = "https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js";
  const PLAY_TIMEOUT_MS = 20000;
  const TABS = [
    { key: "lectures", label: "Lectures" },
    { key: "modules", label: "Modules" },
    { key: "dpp", label: "Practice" },
    { key: "tests", label: "Mock Tests" }
  ];
  const EMPTY_TEXT = {
    lectures: "No chapters match your search.",
    modules: "No modules here yet.",
    dpp: "No practice material here yet.",
    tests: "No tests here yet."
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
  const ICON = {
    book: '<path d="M4 4a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 1 2-2h13"/>',
    video: '<rect x="2" y="4" width="20" height="15" rx="3"/><path d="m10 9 5 3-5 3z" fill="currentColor"/>',
    pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h1M8 17h6M8 9h2"/>',
    dl: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/>',
    play: '<path d="M6 4v16l14-8z" fill="currentColor"/>',
    chev: '<path d="m6 9 6 6 6-6"/>'
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

  /* ---------- data store ---------- */
  const store = { promise: null, batches: new Map(), order: [] };

  function summarize(raw) {
    const trackNames = Object.keys(raw.tracks || {});
    let lectures = 0, chapters = 0;
    trackNames.forEach((t) => {
      const list = raw.tracks[t] || [];
      chapters += list.length;
      list.forEach((c) => { lectures += (c.l || []).length; });
    });
    const docs = raw.docs || {};
    const docCount = (docs.modules || []).length + (docs.dpp || []).length + (docs.tests || []).length;
    const parts = [];
    parts.push(`${chapters} chapter${chapters === 1 ? "" : "s"}`);
    parts.push(`${lectures} lecture${lectures === 1 ? "" : "s"}`);
    return {
      trackNames, lectures, chapters, docCount,
      card: {
        _id: raw.id,
        name: raw.name,
        byName: parts.join(" · "),
        language: trackNames.join(", "),
        category: CATEGORY,
        type: "SARVAM",
        slug: raw.id,
        subBatches: [],
        detailFacts: [
          ["Lectures", lectures],
          ["Chapters", chapters],
          ["Documents", docCount],
          ["Tracks", trackNames.length]
        ]
      }
    };
  }

  function buildSearchText(raw) {
    const parts = [raw.name];
    Object.keys(raw.tracks || {}).forEach((t) => {
      parts.push(t);
      (raw.tracks[t] || []).forEach((c) => {
        parts.push(c.n);
        (c.l || []).forEach((l) => parts.push(l.t));
      });
    });
    const docs = raw.docs || {};
    ["modules", "dpp", "tests"].forEach((k) => (docs[k] || []).forEach((d) => parts.push(d.t)));
    return parts.filter(Boolean).join(" ").toLowerCase();
  }

  function ensure() {
    if (store.promise) return store.promise;
    store.promise = fetch(DATA_URL, { cache: "no-cache" })
      .then((r) => { if (!r.ok) throw new Error("Sarvam data unavailable"); return r.json(); })
      .then((data) => {
        (data.batches || []).forEach((raw) => {
          if (!raw || !raw.id) return;
          const info = summarize(raw);
          store.batches.set(raw.id, { raw, info, text: buildSearchText(raw) });
          store.order.push(raw.id);
        });
        return store;
      })
      .catch((err) => { console.error(err); store.promise = null; return store; });
    return store.promise;
  }

  async function cards() {
    await ensure();
    const list = store.order.map((id) => store.batches.get(id).info.card);
    if (list.length && typeof registerFilter === "function") registerFilter(CATEGORY, CATEGORY_LABEL);
    return list;
  }

  function searchText(batch) {
    const id = batch && (batch._id || batch.batch_id);
    const entry = id && store.batches.get(id);
    return entry ? entry.text : "";
  }

  const owns = (id) => typeof id === "string" && id.indexOf("sarvam-") === 0;

  /* ---------- history layers (phone back button steps back one screen) ---------- */
  const layers = [];
  let ignorePops = 0;
  function pushLayer(kind) {
    layers.push(kind);
    try { history.pushState({ cxSv: kind }, "", location.href); } catch (e) {}
  }
  function dropLayersFrom(index) {
    const n = layers.length - index;
    if (n <= 0) return;
    layers.length = index;
    ignorePops++;
    try { history.go(-n); } catch (e) { ignorePops--; }
  }
  window.addEventListener("popstate", () => {
    if (ignorePops > 0) { ignorePops--; return; }
    const top = layers.pop();
    if (top === "player") closeModal("sarvamPlayerModal");
    else if (top === "batch") closeModal("sarvamModal");
  });

  /* ---------- batch view ---------- */
  const view = { entry: null, tab: "lectures", track: null, q: "" };
  let searchTimer = 0;

  function chaptersOf() {
    return (view.entry && view.entry.raw.tracks[view.track]) || [];
  }
  function docsOf(kind) {
    return (view.entry && view.entry.raw.docs && view.entry.raw.docs[kind]) || [];
  }
  // word-based matching (same idea as the site search): every typed word must appear in the item's text
  const wordsOf = (q) => String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  const hitsAll = (text, words) => words.every((w) => text.includes(w));
  function chapterNameHit(c, words) {
    return hitsAll((c.n || "").toLowerCase(), words);
  }
  function lectureHit(c, l, words) {
    return hitsAll(`${c.n || ""} ${l.t || ""}`.toLowerCase(), words);
  }
  function matchChapter(c, words) {
    if (!words.length) return true;
    return chapterNameHit(c, words) || (c.l || []).some((l) => lectureHit(c, l, words));
  }
  function docHit(d, words) {
    return !words.length || hitsAll((d.t || "").toLowerCase(), words);
  }
  function hasContentMatch(entry, words) {
    const raw = entry.raw;
    const inTracks = Object.keys(raw.tracks || {}).some((t) => (raw.tracks[t] || []).some((c) => matchChapter(c, words)));
    if (inTracks) return true;
    const docs = raw.docs || {};
    return ["modules", "dpp", "tests"].some((k) => (docs[k] || []).some((d) => docHit(d, words)));
  }

  function renderHead() {
    const { entry } = view;
    $("svTitle").textContent = entry.raw.name;
    $("svSub").textContent = entry.info.card.byName;
    const s = entry.info;
    const tiles = [
      [s.lectures, "Video Lectures"],
      [s.chapters, "Chapters"],
      [s.docCount, "Documents"],
      [s.trackNames.length, "Tracks"]
    ];
    $("svStats").innerHTML = tiles.map(([v, l]) => `<div class="stat-chip"><span class="stat-chip-value">${Number(v).toLocaleString()}</span><span class="stat-chip-label">${esc(l)}</span></div>`).join("");
  }

  function renderTracks() {
    const names = view.entry.info.trackNames;
    const box = $("svTracks");
    box.innerHTML = names.map((t) => `<button type="button" class="filter${t === view.track ? " active" : ""}" data-track="${esc(t)}">${esc(t)}</button>`).join("");
    box.querySelectorAll("[data-track]").forEach((b) => b.addEventListener("click", () => {
      view.track = b.dataset.track;
      renderTracks();
      renderTabs();
      renderBody();
    }));
  }

  function renderTabs() {
    const counts = {
      lectures: chaptersOf().length,
      modules: docsOf("modules").length,
      dpp: docsOf("dpp").length,
      tests: docsOf("tests").length
    };
    const box = $("svTabs");
    box.innerHTML = TABS.map((t) => `<button type="button" role="tab" class="filter sv-tab${t.key === view.tab ? " active" : ""}" aria-selected="${t.key === view.tab}" data-tab="${t.key}">${esc(t.label)}<span class="sv-n">${counts[t.key]}</span></button>`).join("");
    box.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      view.tab = b.dataset.tab;
      renderTabs();
      renderBody();
      // keep the list just below the sticky tab bar (never hidden underneath it)
      const panel = $("sarvamModal").querySelector(".sv-modal");
      const delta = $("svBody").getBoundingClientRect().top - $("svTabs").getBoundingClientRect().bottom;
      if (panel && delta < 0) panel.scrollTop += delta;
    }));
  }

  function emptyEl(text) {
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = text;
    return d;
  }

  function renderBody() {
    const body = $("svBody");
    body.innerHTML = "";
    body.setAttribute("role", "tabpanel");
    if (view.tab === "lectures") renderLectures(body);
    else renderDocs(body, view.tab);
  }

  function renderLectures(body) {
    const words = wordsOf(view.q);
    const list = chaptersOf().filter((c) => matchChapter(c, words));
    if (!list.length) { body.appendChild(emptyEl(EMPTY_TEXT.lectures)); return; }
    const frag = document.createDocumentFragment();
    const autoOpen = words.length > 0 && list.length <= 6;
    list.forEach((c, i) => {
      const all = c.l || [];
      // while searching, a chapter that matched only through its lectures lists just those lectures
      const lectures = words.length && !chapterNameHit(c, words) ? all.filter((l) => lectureHit(c, l, words)) : all;
      const nl = lectures.length;
      const folder = document.createElement("div");
      folder.className = "sv-folder";
      folder.style.animation = `fade-in .35s ease ${Math.min(i * 20, 300)}ms both`;
      folder.innerHTML =
        `<button type="button" class="sv-fh" aria-expanded="false"><span class="sv-fi">${icon("book")}</span>` +
        `<span class="sv-ft"><h3>${esc(c.n)}</h3><span class="sv-meta">${icon("video")}${nl} lecture${nl === 1 ? "" : "s"}</span></span>` +
        `<span class="sv-chev">${icon("chev")}</span></button><div class="sv-fb"><div class="sv-list"></div></div>`;
      const head = folder.querySelector(".sv-fh");
      const listEl = folder.querySelector(".sv-list");
      const toggle = (force) => {
        const open = typeof force === "boolean" ? force : !folder.classList.contains("op");
        folder.classList.toggle("op", open);
        head.setAttribute("aria-expanded", String(open));
        if (open && !listEl.children.length) fillLectures(listEl, c, lectures);
      };
      head.addEventListener("click", () => toggle());
      frag.appendChild(folder);
      if (autoOpen) toggle(true);
    });
    body.appendChild(frag);
  }

  function fillLectures(listEl, chapter, lectures) {
    const frag = document.createDocumentFragment();
    lectures.forEach((l, j) => {
      const playable = isHttp(l.u);
      const row = document.createElement("div");
      row.className = "sv-lec" + (playable ? "" : " off");
      row.style.animationDelay = Math.min(j * 40, 400) + "ms";
      if (playable) { row.tabIndex = 0; row.setAttribute("role", "button"); }
      row.innerHTML =
        `<span class="sv-num">${String(j + 1).padStart(2, "0")}</span>` +
        `<span class="sv-info"><b>${esc(l.t)}</b>${l.m ? `<em>${esc(l.m)}</em>` : ""}</span>` +
        (playable ? `<span class="sv-play" aria-hidden="true">${icon("play")}</span>` : "");
      if (playable) {
        const go = () => play(l.u, `${chapter.n} · ${l.t}`);
        row.addEventListener("click", go);
        row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      }
      frag.appendChild(row);
    });
    listEl.appendChild(frag);
  }

  function renderDocs(body, kind) {
    const words = wordsOf(view.q);
    const list = docsOf(kind).filter((d) => docHit(d, words));
    if (!list.length) { body.appendChild(emptyEl(EMPTY_TEXT[kind] || "No documents here yet.")); return; }
    const wrap = document.createElement("div");
    wrap.className = "sv-docs";
    list.forEach((d, i) => {
      const ok = isHttp(d.u);
      const card = document.createElement("div");
      card.className = "sv-doc";
      card.style.animation = `fade-in .3s ease ${Math.min(i * 25, 300)}ms both`;
      card.innerHTML =
        `<div class="sv-doc-h"><span class="sv-fi">${icon("pdf")}</span><h4>${esc(d.t)}</h4></div>` +
        `<div class="sv-doc-m"><span class="chip">PDF</span>${d.d ? `<span class="chip">${esc(d.d)}</span>` : ""}<span class="chip">Ref #${String(i + 1).padStart(3, "0")}</span></div>` +
        (ok ? `<div class="sv-doc-b"><button type="button" class="btn btn-primary" data-a="open">${icon("play")}Open</button><button type="button" class="btn btn-quiet" data-a="dl">${icon("dl")}Download</button></div>` : "");
      if (ok) {
        card.querySelector('[data-a="open"]').addEventListener("click", () => window.open(d.u, "_blank", "noopener"));
        card.querySelector('[data-a="dl"]').addEventListener("click", () => {
          const a = document.createElement("a");
          a.href = d.u; a.rel = "noopener"; a.target = "_blank"; a.download = "";
          document.body.appendChild(a); a.click(); a.remove();
        });
      }
      wrap.appendChild(card);
    });
    body.appendChild(wrap);
  }

  function setQuery(q) {
    view.q = q.trim();
    const input = $("svSearch");
    if (input && input.value !== q) input.value = q;
    $("svClear").style.display = view.q ? "grid" : "none";
    renderBody();
  }

  async function open(batch) {
    const id = batch && (batch._id || batch.batch_id);
    // read the query the person just searched with *before* awaiting: app.js closes the search modal right after openBatch()
    const searchModalOpen = $("searchModal") && $("searchModal").classList.contains("visible");
    const rawQ = (((searchModalOpen ? $("searchInput") : $("inlineSearchInput")) || {}).value || "").trim();
    const carry = wordsOf(rawQ);
    await ensure();
    const entry = store.batches.get(id);
    if (!entry) { showToast("This course is not available right now."); return; }
    view.entry = entry;
    view.tab = "lectures";
    view.track = entry.info.trackNames[0] || null;
    view.q = carry.length && hasContentMatch(entry, carry) ? rawQ : "";
    $("svSearch").value = view.q;
    $("svClear").style.display = view.q ? "grid" : "none";
    renderHead();
    renderTracks();
    renderTabs();
    renderBody();
    const modal = $("sarvamModal");
    $$(".overlay.visible").forEach((o) => { if (o.id !== "sarvamModal") o.classList.remove("visible"); });
    if (!modal.classList.contains("visible")) {
      modal.classList.add("visible");
      document.body.classList.add("modal-open");
      pushLayer("batch");
    }
    const panel = modal.querySelector(".sv-modal");
    if (panel) panel.scrollTop = 0;
  }

  /* ---------- the one player (HLS) ---------- */
  let hls = null;
  let playToken = 0;
  let playTimer = 0;
  let hlsPromise = null;
  let lastPlay = null;

  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsPromise) return hlsPromise;
    hlsPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = HLS_SRC;
      s.async = true;
      s.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error("hls.js unavailable")));
      s.onerror = () => { hlsPromise = null; reject(new Error("hls.js failed to load")); };
      document.head.appendChild(s);
    });
    return hlsPromise;
  }

  function resetVideo() {
    const v = $("svVideo");
    clearTimeout(playTimer);
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    try { v.pause(); } catch (e) {}
    v.removeAttribute("src");
    try { v.load(); } catch (e) {}
    return v;
  }

  function stopPlayback() {
    playToken++;
    resetVideo();
    $("svVideo").style.display = "none";
  }

  function play(url, title) {
    if (!isHttp(url)) { showToast("This lecture has no playable link."); return; }
    lastPlay = { url, title };
    const token = ++playToken;
    const modal = $("sarvamPlayerModal");
    $("svPlayerTitle").textContent = title || "Streaming…";
    if (!modal.classList.contains("visible")) {
      modal.classList.add("visible");
      document.body.classList.add("modal-open");
      pushLayer("player");
    }
    const v = resetVideo();
    const loading = $("svLoading");
    const error = $("svError");
    v.style.display = "none";
    error.classList.remove("on");
    loading.style.display = "flex";

    const stale = () => token !== playToken;
    const ok = () => {
      if (stale()) return;
      clearTimeout(playTimer);
      loading.style.display = "none";
      v.style.display = "block";
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    };
    const fail = () => {
      if (stale()) return;
      clearTimeout(playTimer);
      resetVideo();
      loading.style.display = "none";
      v.style.display = "none";
      error.classList.add("on");
    };
    playTimer = setTimeout(fail, PLAY_TIMEOUT_MS);

    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = url;
      v.addEventListener("loadedmetadata", ok, { once: true });
      v.addEventListener("error", fail, { once: true });
      return;
    }
    loadHls().then((Hls) => {
      if (stale()) return;
      if (Hls.isSupported()) {
        hls = new Hls({ maxBufferLength: 30 });
        hls.loadSource(url);
        hls.attachMedia(v);
        hls.on(Hls.Events.MANIFEST_PARSED, ok);
        hls.on(Hls.Events.ERROR, (_, d) => { if (d && d.fatal) fail(); });
      } else {
        v.src = url;
        v.addEventListener("loadedmetadata", ok, { once: true });
        v.addEventListener("error", fail, { once: true });
      }
    }).catch(() => {
      if (stale()) return;
      // hls.js could not be loaded: last resort is the native element, which reports its own error
      v.src = url;
      v.addEventListener("loadedmetadata", ok, { once: true });
      v.addEventListener("error", fail, { once: true });
    });
  }

  /* ---------- wiring ---------- */
  function watchOverlays() {
    const batchEl = $("sarvamModal");
    const playerEl = $("sarvamPlayerModal");
    if (!batchEl || !playerEl) return;
    new MutationObserver(() => {
      if (playerEl.classList.contains("visible")) return;
      stopPlayback();
      const i = layers.lastIndexOf("player");
      if (i >= 0) dropLayersFrom(i);
    }).observe(playerEl, { attributes: true, attributeFilter: ["class"] });
    new MutationObserver(() => {
      if (batchEl.classList.contains("visible")) return;
      if (playerEl.classList.contains("visible")) playerEl.classList.remove("visible");
      stopPlayback();
      const i = layers.indexOf("batch");
      if (i >= 0) dropLayersFrom(i);
      if (!document.querySelector(".overlay.visible")) document.body.classList.remove("modal-open");
    }).observe(batchEl, { attributes: true, attributeFilter: ["class"] });

    // Escape steps back one layer (player first, then batch) instead of closing everything at once
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (playerEl.classList.contains("visible")) {
        e.stopImmediatePropagation();
        closeModal("sarvamPlayerModal");
      }
    }, true);

    $("svSearch").addEventListener("input", (e) => {
      const value = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => setQuery(value), 150);
    });
    $("svClear").addEventListener("click", () => { $("svSearch").value = ""; setQuery(""); $("svSearch").focus(); });
    $("svRetry").addEventListener("click", () => { if (lastPlay) play(lastPlay.url, lastPlay.title); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchOverlays);
  else watchOverlays();

  // warm the data as soon as the script runs so search can see it right away
  ensure().then(() => { if (store.order.length && typeof registerFilter === "function") registerFilter(CATEGORY, CATEGORY_LABEL); });

  window.SarvamStore = { cards, searchText, owns, open, ensure };
})();
