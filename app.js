(() => {
  "use strict";

  const LEVELS = ["Yellow · easiest", "Green", "Blue", "Purple · trickiest"];
  const EMOJI = ["🟨", "🟩", "🟦", "🟪"];
  const MAX_MISTAKES = 4;
  const DRAFT_KEY = "gc:draft";

  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const EXAMPLE = {
    title: "Sample Puzzle",
    author: "Me",
    groups: [
      { name: "Breakfast foods", words: ["Waffle", "Pancake", "Omelet", "Bagel"] },
      { name: "Card games", words: ["Rummy", "Snap", "Hearts", "Poker"] },
      { name: "___ball", words: ["Basket", "Foot", "Snow", "Meat"] },
      { name: "Things with keys", words: ["Piano", "Map", "Lock", "Keyboard"] },
    ],
  };

  /* ================= encoding ================= */

  // A puzzle travels entirely inside the link. Current links ("c=") hold the
  // 22 text fields, plus an optional starting layout, as newline-separated
  // text, deflated, then base64url-encoded. Older links ("p=") hold
  // uncompressed JSON and still decode.
  //
  // A layout lists the 16 grid positions as slot numbers (group * 4 + word),
  // written in the link as 16 hex digits.
  const toB64url = (bytes) => {
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const fromB64url = (code) => {
    let s = code.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  };
  const pipeBytes = (bytes, stream) =>
    new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer().then((b) => new Uint8Array(b));
  const canCompress = typeof CompressionStream === "function";

  // Returns the link fragment for a puzzle, e.g. "c=…".
  async function encodePuzzle(p) {
    const clean = (s) => s.replace(/[\r\n]+/g, " ");
    if (canCompress) {
      const fields = [p.title, p.author, ...p.groups.flatMap((g) => [g.name, ...g.words])];
      if (p.layout) fields.push(p.layout.map((n) => n.toString(16)).join(""));
      const raw = new TextEncoder().encode(fields.map(clean).join("\n"));
      return "c=" + toB64url(await pipeBytes(raw, new CompressionStream("deflate-raw")));
    }
    const data = [p.title, p.author, p.groups.map((g) => [g.name, ...g.words])];
    if (p.layout) data.push(p.layout);
    return "p=" + toB64url(new TextEncoder().encode(JSON.stringify(data)));
  }

  async function decodePuzzle(fragment) {
    let title, author, groups, layout;
    if (fragment.startsWith("c=")) {
      const raw = await pipeBytes(fromB64url(fragment.slice(2)), new DecompressionStream("deflate-raw"));
      const f = new TextDecoder().decode(raw).split("\n");
      if (f.length !== 22 && f.length !== 23) throw new Error("bad puzzle");
      [title, author] = f;
      groups = [0, 1, 2, 3].map((i) => f.slice(2 + i * 5, 7 + i * 5));
      if (f[22]) layout = [...f[22]].map((c) => parseInt(c, 16));
    } else if (fragment.startsWith("p=")) {
      [title, author, groups, layout] = JSON.parse(new TextDecoder().decode(fromB64url(fragment.slice(2))));
    } else {
      throw new Error("not a puzzle link");
    }
    if (!Array.isArray(groups) || groups.length !== 4) throw new Error("bad puzzle");
    const puzzle = {
      title: String(title || ""),
      author: String(author || ""),
      groups: groups.map((g) => {
        if (!Array.isArray(g) || g.length !== 5) throw new Error("bad group");
        return { name: String(g[0]), words: g.slice(1).map(String) };
      }),
    };
    if (validatePuzzle(puzzle)) throw new Error("invalid puzzle");
    if (layout !== undefined) {
      if (!isLayout(layout)) throw new Error("bad layout");
      puzzle.layout = layout;
    }
    return puzzle;
  }

  // True if `a` is an arrangement of the slots 0–15, each used once.
  const isLayout = (a) =>
    Array.isArray(a) && a.length === 16 && [...a].sort((x, y) => x - y).every((n, i) => n === i);

  const norm = (w) => w.trim().toUpperCase();

  /* ================= text fitting ================= */

  // Sets `text`'s font size to the largest that fits inside `box` (at most
  // its stylesheet size). Words are never broken: a phrase may wrap between
  // words, but each word must fit on one line.
  function fitText(box, text) {
    text.style.fontSize = "";
    const cs = getComputedStyle(box);
    const h = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (!text.clientWidth || h <= 0) return; // not visible yet; refit when shown
    // `text` is capped at the box's width, so a word too long for one line
    // shows up as scrollWidth exceeding its own width.
    const fits = () => text.scrollWidth <= text.clientWidth && text.offsetHeight <= h;
    let hi = parseFloat(getComputedStyle(text).fontSize);
    if (fits()) return;
    let lo = 4;
    while (hi - lo > 0.25) {
      const mid = (lo + hi) / 2;
      text.style.fontSize = mid + "px";
      if (fits()) lo = mid;
      else hi = mid;
    }
    text.style.fontSize = lo + "px";
  }

  // Fits every tile and solved-row line inside `root`.
  function fitAll(root) {
    root.querySelectorAll(".tile, .atile").forEach((t) => fitText(t, t.firstElementChild));
    root.querySelectorAll(".solved").forEach((row) => [...row.children].forEach((line) => fitText(row, line)));
  }

  const refit = () => {
    if (!$("play-view").hidden) fitAll($("board"));
    if (!$("create-view").hidden) fitAll($("arrange"));
  };
  window.addEventListener("resize", refit);
  // The web font may arrive after the first render and change text widths.
  if (document.fonts) document.fonts.ready.then(refit);

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Returns an error message, or "" if the puzzle is playable.
  function validatePuzzle(p) {
    const seen = new Set();
    for (let i = 0; i < 4; i++) {
      const g = p.groups[i];
      if (!g.name.trim()) return `Give the ${LEVELS[i].split(" ")[0].toLowerCase()} group a category name.`;
      for (const w of g.words) {
        if (!w.trim()) return `Fill in all four words for "${g.name.trim()}".`;
        const n = norm(w);
        if (seen.has(n)) return `"${n}" is used more than once — every word must be unique.`;
        seen.add(n);
      }
    }
    return "";
  }

  /* ================= routing ================= */

  async function route() {
    const hash = location.hash.slice(1);
    if (hash.startsWith("c=") || hash.startsWith("p=")) {
      try {
        startGame(await decodePuzzle(hash), hash);
        return;
      } catch (e) {
        console.error(e);
        toast("That puzzle link looks broken.");
      }
    }
    showView("create");
  }

  function showView(name) {
    $("create-view").hidden = name !== "create";
    $("play-view").hidden = name !== "play";
    $("make-link").hidden = name === "create";
    window.scrollTo(0, 0);
    refit();
  }

  window.addEventListener("hashchange", route);
  document.querySelectorAll(".make-own").forEach((a) =>
    a.addEventListener("click", () => {
      const d = $("results");
      if (d.open) d.close();
    })
  );

  /* ================= toast ================= */

  let toastTimer;
  function toast(msg, ms = 1600) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }

  /* ================= create view ================= */

  const groupFields = $("group-fields");
  for (let i = 0; i < 4; i++) {
    const card = document.createElement("fieldset");
    card.className = `group-card c${i}`;
    card.innerHTML = `
      <div class="level">${LEVELS[i]}</div>
      <input class="cat" data-g="${i}" maxlength="60" placeholder="Category (shown when solved)" aria-label="Group ${i + 1} category">
      <div class="word-row">
        ${[0, 1, 2, 3]
          .map((j) => `<input class="word" data-g="${i}" data-w="${j}" maxlength="24" placeholder="Word ${j + 1}" aria-label="Group ${i + 1} word ${j + 1}">`)
          .join("")}
      </div>`;
    groupFields.appendChild(card);
  }

  // Starting grid chosen in the maker: 16 slot numbers (group * 4 + word).
  let layout = shuffle([...Array(16).keys()]);
  let picked = null; // grid position waiting for a second tap to swap

  function readForm() {
    const p = { title: $("f-title").value.trim(), author: $("f-author").value.trim(), groups: [], layout: layout.slice() };
    for (let i = 0; i < 4; i++) {
      p.groups.push({
        name: document.querySelector(`.cat[data-g="${i}"]`).value.trim(),
        words: [0, 1, 2, 3].map((j) => document.querySelector(`.word[data-g="${i}"][data-w="${j}"]`).value.trim()),
      });
    }
    return p;
  }

  function fillForm(p) {
    $("f-title").value = p.title || "";
    $("f-author").value = p.author || "";
    for (let i = 0; i < 4; i++) {
      const g = (p.groups && p.groups[i]) || { name: "", words: [] };
      document.querySelector(`.cat[data-g="${i}"]`).value = g.name || "";
      for (let j = 0; j < 4; j++) {
        document.querySelector(`.word[data-g="${i}"][data-w="${j}"]`).value = (g.words && g.words[j]) || "";
      }
    }
    layout = isLayout(p.layout) ? p.layout.slice() : shuffle([...Array(16).keys()]);
    picked = null;
    renderArrange();
  }

  function renderArrange() {
    const grid = $("arrange");
    grid.replaceChildren();
    layout.forEach((slot, pos) => {
      const g = slot >> 2;
      const word = document.querySelector(`.word[data-g="${g}"][data-w="${slot & 3}"]`).value.trim();
      const b = document.createElement("button");
      b.type = "button";
      b.className = `atile c${g}` + (pos === picked ? " picked" : "") + (word ? "" : " empty");
      b.setAttribute("aria-pressed", pos === picked ? "true" : "false");
      b.setAttribute("aria-label", `${word || "Empty"}, ${LEVELS[g].split(" ")[0]} group, position ${pos + 1}`);
      const span = document.createElement("span");
      span.textContent = word ? norm(word) : "—";
      b.appendChild(span);
      b.addEventListener("click", () => pickTile(pos));
      grid.appendChild(b);
    });
    fitAll(grid);
  }

  function pickTile(pos) {
    if (picked === null) picked = pos;
    else if (picked === pos) picked = null;
    else {
      [layout[picked], layout[pos]] = [layout[pos], layout[picked]];
      picked = null;
      saveDraft();
      $("share-box").hidden = true;
    }
    renderArrange();
    if (picked !== null) $("arrange").children[picked].focus();
  }

  $("btn-arrange-shuffle").addEventListener("click", () => {
    layout = shuffle(layout);
    picked = null;
    saveDraft();
    $("share-box").hidden = true;
    renderArrange();
  });

  function markInvalid() {
    const counts = {};
    document.querySelectorAll(".word").forEach((el) => {
      const n = norm(el.value);
      if (n) counts[n] = (counts[n] || 0) + 1;
    });
    document.querySelectorAll(".word").forEach((el) => {
      const n = norm(el.value);
      el.classList.toggle("invalid", !n || counts[n] > 1);
    });
    document.querySelectorAll(".cat").forEach((el) => el.classList.toggle("invalid", !el.value.trim()));
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(readForm()));
    } catch {}
  }

  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    fillForm(draft || EXAMPLE);
  } catch {
    fillForm(EXAMPLE);
  }

  $("create-form").addEventListener("input", (e) => {
    saveDraft();
    if (e.target.classList.contains("word")) renderArrange();
    $("share-box").hidden = true;
    if (e.target.classList.contains("invalid")) markInvalid();
  });

  function buildPuzzleOrError() {
    const p = readForm();
    const err = validatePuzzle(p);
    $("form-error").textContent = err;
    if (err) {
      markInvalid();
      return null;
    }
    document.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
    return p;
  }

  const playUrl = (fragment) => `${location.origin}${location.pathname}#${fragment}`;

  $("create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p = buildPuzzleOrError();
    if (!p) return;
    const url = playUrl(await encodePuzzle(p));
    $("share-url").value = url;
    $("btn-open").href = url;
    $("btn-native-share").hidden = !navigator.share;
    $("framed-note").hidden = window.top === window;
    $("share-box").hidden = false;
    $("share-box").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  $("btn-preview").addEventListener("click", async () => {
    const p = buildPuzzleOrError();
    if (p) location.hash = await encodePuzzle(p);
  });

  $("btn-example").addEventListener("click", () => {
    fillForm(EXAMPLE);
    saveDraft();
    markInvalid();
    $("form-error").textContent = "";
  });

  // Two-step clear instead of confirm(), which some embedded browsers block.
  let clearArmed = null;
  $("btn-clear").addEventListener("click", () => {
    const btn = $("btn-clear");
    if (!clearArmed) {
      btn.textContent = "Tap again to clear";
      clearArmed = setTimeout(() => {
        clearArmed = null;
        btn.textContent = "Clear";
      }, 3000);
      return;
    }
    clearTimeout(clearArmed);
    clearArmed = null;
    btn.textContent = "Clear";
    fillForm({});
    saveDraft();
    $("form-error").textContent = "";
    $("share-box").hidden = true;
    document.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
  });

  $("btn-copy").addEventListener("click", async () => {
    if (await copyText($("share-url").value)) toast("Link copied!");
  });
  $("share-url").addEventListener("focus", (e) => e.target.select());

  $("btn-native-share").addEventListener("click", () => {
    const title = $("f-title").value.trim() || "Grey Connections";
    navigator.share({ title, text: "Can you solve my Connections puzzle?", url: $("share-url").value }).catch(() => {});
  });

  /* ================= play view ================= */

  let puzzle, state, storeKey, busy = false;
  const wordGroup = new Map(); // normalized word -> group index

  function startGame(p, fragment) {
    puzzle = p;
    wordGroup.clear();
    puzzle.groups.forEach((g, gi) => g.words.forEach((w) => wordGroup.set(norm(w), gi)));

    storeKey = "gc:play:" + fragment;
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(storeKey) || "null");
    } catch {}
    const startOrder = puzzle.layout
      ? puzzle.layout.map((slot) => norm(puzzle.groups[slot >> 2].words[slot & 3]))
      : shuffle([...wordGroup.keys()]);
    state = saved || {
      order: startOrder,
      selected: [],
      solved: [],
      mistakes: 0,
      guesses: [],
      done: false,
      won: false,
    };
    state.selected = [];
    if (state.done && state.order.length) {
      // Reloaded mid-reveal: finish revealing the remaining groups.
      for (let gi = 0; gi < 4; gi++) if (!state.solved.includes(gi)) state.solved.push(gi);
      state.order = [];
    }

    document.title = (puzzle.title || "Puzzle") + " · Grey Connections";
    $("p-title").textContent = puzzle.title || "Connections";
    $("p-author").textContent = puzzle.author ? `by ${puzzle.author}` : "";
    showView("play");
    render();
    if (state.done) $("results").open || setTimeout(showResults, 300);
  }

  function save() {
    try {
      localStorage.setItem(storeKey, JSON.stringify({ ...state, selected: [] }));
    } catch {}
  }

  function solvedRow(gi) {
    const g = puzzle.groups[gi];
    const el = document.createElement("div");
    el.className = `solved c${gi}`;
    const name = document.createElement("strong");
    name.textContent = g.name;
    const words = document.createElement("span");
    words.textContent = g.words.map(norm).join(", ");
    el.append(name, words);
    return el;
  }

  function render() {
    const board = $("board");
    board.replaceChildren();
    state.solved.forEach((gi) => board.appendChild(solvedRow(gi)));
    state.order.forEach((w) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tile";
      b.dataset.word = w;
      const s = document.createElement("span");
      s.textContent = w;
      b.appendChild(s);
      if (state.selected.includes(w)) b.classList.add("selected");
      b.addEventListener("click", () => toggle(w, b));
      board.appendChild(b);
    });
    fitAll($("board"));
    renderControls();
  }


  function renderControls() {
    const dots = $("mistake-dots");
    dots.replaceChildren();
    for (let i = state.mistakes; i < MAX_MISTAKES; i++) dots.appendChild(document.createElement("i"));
    $("btn-submit").disabled = state.selected.length !== 4 || busy;
    $("btn-deselect").disabled = state.selected.length === 0 || busy;
    $("btn-shuffle").disabled = busy;
    $("controls").hidden = state.done;
    $("mistakes").hidden = state.done;
    $("end-controls").hidden = !state.done;
  }

  function toggle(w, el) {
    if (busy || state.done) return;
    const i = state.selected.indexOf(w);
    if (i >= 0) state.selected.splice(i, 1);
    else if (state.selected.length < 4) state.selected.push(w);
    else return;
    el.classList.toggle("selected", i < 0);
    renderControls();
  }

  $("btn-shuffle").addEventListener("click", () => {
    state.order = shuffle(state.order);
    save();
    render();
  });

  $("btn-deselect").addEventListener("click", () => {
    state.selected = [];
    document.querySelectorAll(".tile.selected").forEach((t) => t.classList.remove("selected"));
    renderControls();
  });

  const tileFor = (w) => document.querySelector(`.tile[data-word="${CSS.escape(w)}"]`);

  $("btn-submit").addEventListener("click", submit);

  async function submit() {
    if (busy || state.selected.length !== 4) return;
    // Record guesses in grid order, which is how they appear in the results grid.
    const guess = state.order.filter((w) => state.selected.includes(w));
    const key = guess.slice().sort().join("|");
    if (state.guesses.some((g) => g.slice().sort().join("|") === key)) {
      toast("Already guessed!");
      return;
    }

    busy = true;
    renderControls();
    state.guesses.push(guess);

    const tiles = guess.map(tileFor);
    for (const t of tiles) {
      t.classList.add("jump");
      await wait(90);
    }
    await wait(350);
    tiles.forEach((t) => t.classList.remove("jump"));

    const groups = guess.map((w) => wordGroup.get(w));
    const counts = [0, 0, 0, 0];
    groups.forEach((g) => counts[g]++);
    const best = Math.max(...counts);

    if (best === 4) {
      const gi = groups[0];
      tiles.forEach((t) => t.classList.add("fade-out"));
      await wait(250);
      state.solved.push(gi);
      state.order = state.order.filter((w) => !guess.includes(w));
      state.selected = [];
      if (state.solved.length === 4) {
        state.done = true;
        state.won = true;
      }
      save();
      render();
    } else {
      if (best === 3) toast("One away...");
      tiles.forEach((t) => t.classList.add("shake"));
      await wait(400);
      tiles.forEach((t) => t.classList.remove("shake"));
      state.mistakes++;
      if (state.mistakes >= MAX_MISTAKES) {
        state.done = true;
        state.selected = [];
        save();
        render();
        await revealRemaining();
      } else {
        save();
        renderControls();
      }
    }

    busy = false;
    renderControls();
    if (state.done) setTimeout(showResults, 900);
  }

  async function revealRemaining() {
    if (!state.order.length) return;
    toast("Next time!", 1400);
    await wait(700);
    for (let gi = 0; gi < 4; gi++) {
      if (state.solved.includes(gi)) continue;
      state.solved.push(gi);
      const words = puzzle.groups[gi].words.map(norm);
      state.order = state.order.filter((w) => !words.includes(w));
      save();
      render();
      await wait(700);
    }
  }

  /* ================= results ================= */

  function resultsText() {
    const rows = state.guesses.map((g) => g.map((w) => EMOJI[wordGroup.get(w)]).join(""));
    const head = puzzle.title ? `Grey Connections\n${puzzle.title}` : "Grey Connections";
    return `${head}\n${rows.join("\n")}\n${location.href}`;
  }

  function showResults() {
    const headings = ["Perfect!", "Great!", "Solid!", "Phew!"];
    $("r-heading").textContent = state.won ? headings[state.mistakes] || "Nice!" : "Next Time!";
    $("r-sub").textContent = state.won
      ? `You solved ${puzzle.title ? `“${puzzle.title}”` : "the puzzle"} with ${state.mistakes} mistake${state.mistakes === 1 ? "" : "s"}.`
      : `${puzzle.title ? `“${puzzle.title}”` : "This one"} got you this time.`;

    const grid = $("r-grid");
    grid.replaceChildren();
    state.guesses.forEach((g) => {
      const row = document.createElement("div");
      row.className = "r-row";
      g.forEach((w) => {
        const i = document.createElement("i");
        i.className = `c${wordGroup.get(w)}`;
        row.appendChild(i);
      });
      grid.appendChild(row);
    });

    const d = $("results");
    if (!d.open) d.showModal();
  }

  $("btn-results").addEventListener("click", showResults);
  $("results-close").addEventListener("click", () => $("results").close());
  $("results").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) e.currentTarget.close();
  });

  $("btn-share-results").addEventListener("click", async () => {
    const text = resultsText();
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      navigator.share({ text }).catch(() => {});
    } else if (await copyText(text)) {
      toast("Copied results to clipboard");
    }
  });

  route();
})();
