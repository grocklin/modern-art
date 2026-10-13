// Modern Art — game flow and UI (modern interface).
// The VB6 version drove the game from button-click handlers and a GameState
// number; here the same flow is an async turn loop that awaits the human's input.
// All AI decisions come from ai.js (a faithful port of the original routines).

(function () {
  'use strict';
  const AI = window.MA_AI, IC = window.MA_ICONS;
  const { artist, typeOf } = AI;
  const NAMES = [null, 'Axel', 'Beatrix', 'Clemens', 'Doris'];
  const ARTISTS = [null, 'Lite Metal', 'Yoko', 'Cristin P', 'Karl Gitter', 'Krypto'];
  const AUC = [null, 'Double', 'Hidden', 'Fixed Price', 'Once Around', 'Open'];
  const KIND = [null, 'Double', 'Hidden', 'Fixed', 'Once around', 'Open'];
  const SHORT = [null, 'Double', 'Hidden', 'Fixed', 'Once', 'Open'];
  const ABBR = [null, 'LM', 'YO', 'CP', 'KG', 'KR'];
  const HUMAN = 4;
  const $ = s => document.querySelector(s);
  const next = p => (p % 4) + 1;
  const prev = p => ((p + 2) % 4) + 1;
  const who = p => (p === HUMAN ? 'You' : NAMES[p]);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  class Abort extends Error {}

  // ---- seeded RNG (a game number replays the same deal) --------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- state ---------------------------------------------------------------
  let G = null;
  let token = 0;

  function freshState(num) {
    const tv = [], hist = [];
    for (let r = 0; r <= 4; r++) { tv.push([0, 0, 0, 0, 0, 0]); hist.push(['', '', '', '', '']); }
    return {
      num, rng: mulberry32(num), cards: new Array(71).fill(0), money: [0, 100, 100, 100, 100],
      round: 1, tv, hist, turn: 0, labels: ['', '', '', '', ''], winner: 0, auction: null,
      over: false, scored: false, endMsg: '', endMsgs: [], feed: [],
      // per round, per player: money earned as auctioneer and spent buying paintings
      flow: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ earned: 0, spent: 0, bank: 0 }))),
    };
  }

  const cardName = c => `${ARTISTS[artist(c)]} · ${KIND[typeOf(c)]}`;
  const handOf = p => { const h = []; for (let c = 1; c <= 70; c++) if (G.cards[c] === p) h.push(c); return h; };
  const anyCards = () => G.cards.some((v, i) => i > 0 && v >= 1 && v <= 4);
  const pad7 = n => String(n).padStart(7, '0');
  const listNames = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const sortCards = cs => cs.sort((x, y) => artist(x) - artist(y) || typeOf(x) - typeOf(y) || x - y);

  function deal(round) {
    const n = round === 1 ? 9 : round <= 3 ? 4 : 0;
    const left = [];
    for (let c = 1; c <= 70; c++) if (G.cards[c] === 0) left.push(c);
    for (let p = 1; p <= 4; p++) for (let k = 0; k < n; k++) {
      const i = Math.floor(left.length * G.rng());
      G.cards[left.splice(i, 1)[0]] = p;
    }
  }

  function record(buyer, seller, price, tag) {
    const R = G.round;
    const nm = b => (b === 0 ? 'the bank' : b === HUMAN ? 'you' : NAMES[b]);
    if (seller !== buyer) G.hist[R][seller] += `${tag} sold to ${nm(buyer)} for ${price}\n`;
    if (buyer !== 0) G.hist[R][buyer] += buyer === seller
      ? `${tag} bought (own painting, paid to the bank) for ${price}\n`
      : `${tag} bought from ${nm(seller)} for ${price}\n`;
  }

  // =========================================================================
  // UI primitives
  // =========================================================================
  let handMode = null, handResolve = null, selected = 0, hintCards = [], handModeAt = 0;
  let bidState = null; // {min,max,submit,label,fixed}

  // Keep CSS informed of the dock and sheet heights (the phone layout stacks the bid sheet on
  // top of the hand dock). Measured on every mode change and render, on resize, and by a
  // ResizeObserver: the observer alone doesn't fire while a page isn't being painted.
  function syncLayout() {
    const r = document.documentElement.style;
    r.setProperty('--dock-h', $('#dock').offsetHeight + 'px');
    r.setProperty('--sheet-h', $('#auction').offsetHeight + 'px');
  }
  const ro = new ResizeObserver(syncLayout);

  function setMode(m) { document.body.className = 'mode-' + m; renderPrompt(); syncLayout(); }

  const ui = {
    pending: null,
    wait(mode, setup) {
      const my = token;
      setMode(mode);
      return new Promise((resolve, reject) => {
        this.pending = { reject };
        setup(v => { if (my !== token) return; this.pending = null; this.idle(); resolve(v); });
        syncLayout();
      });
    },
    reset() {
      if (this.pending) { this.pending.reject(new Abort()); this.pending = null; }
      closeModal();
      this.idle();
    },
    idle() {
      handMode = null; handResolve = null; selected = 0; bidState = null;
      setMode('idle');
      $('#bidder').classList.add('off');
      $('#btnOk').hidden = true;
      renderHand();
    },
    status(t) {
      $('#promptText').textContent = t;
      renderPrompt();
    },
    ok(label = 'Continue') {
      return this.wait('ok', done => {
        const b = $('#btnOk');
        b.textContent = label; b.hidden = false;
        b.onclick = () => done(true);
        b.focus({ preventScroll: true });
      });
    },
    // Ask the human for an amount. Returns a number, or null for pass.
    bid({ min, max, def, verb = 'Bid', canPass = true, fixed = false, hint = null }) {
      return this.wait('bid', done => {
        const canBid = min <= max;
        bidState = { min, max, verb, fixed, canBid, hint };
        const box = $('#bidBox'), range = $('#bidRange');
        const v = canBid ? Math.max(min, Math.min(max, def)) : 0;
        box.value = canBid ? String(v) : '';
        range.min = String(min); range.max = String(Math.max(min, max)); range.value = String(v);
        $('#bidMin').textContent = canBid ? `min ${min}` : '';
        $('#bidMax').textContent = canBid ? `max ${max}` : '';
        $('#btnBidHint').disabled = !hint;
        const steppy = canBid && !fixed;
        document.querySelectorAll('.bid-stepper button').forEach(b => { b.disabled = !steppy; });
        box.disabled = !steppy;
        range.hidden = !steppy; $('.bid-range-labels').hidden = !steppy && !hint;
        $('.bid-stepper').hidden = fixed;
        $('#btnPass').disabled = !canPass;
        $('#btnPass').hidden = !canPass;
        $('#bidder').classList.remove('off');
        updateBidLabel();
        $('#btnBid').onclick = () => {
          const n = parseInt(box.value, 10);
          if (isNaN(n) || n < min) { flash(`You can't bid less than ${min}.`); setBidValue(min); return; }
          if (n > max) { flash(`You can't bid more than ${max}.`); setBidValue(max); return; }
          done(n);
        };
        $('#btnPass').onclick = () => done(null);
        if (steppy && matchMedia('(pointer: fine)').matches) { box.focus({ preventScroll: true }); box.select(); }
      });
    },
    // Human picks a painting. mode: {kind:'play'} or {kind:'second', artist, exclude, canCancel}
    card(mode) {
      return this.wait('card', done => {
        handMode = mode; handResolve = done; selected = 0; handModeAt = performance.now();
        $('#btnNoSecond').hidden = mode.kind !== 'second';
        $('#btnNoSecond').textContent = mode.noneLabel || 'No second card';
        $('#btnCancelDouble').hidden = !(mode.kind === 'second' && mode.canCancel);
        $('#btnCardHint').hidden = mode.kind !== 'play';
        $('#btnNoSecond').onclick = () => done('none');
        $('#btnCancelDouble').onclick = () => done('cancel');
        renderHand();
      });
    },
    confirm(msg, yes = 'Yes', no = 'Cancel') {
      return this.wait('modal', done => openModal('Are you sure?', `<p>${esc(msg)}</p>`, [[no, () => done(false), 'secondary'], [yes, () => done(true), 'primary']]));
    },
    dialog(title, html, label) {
      return this.wait('modal', done => openModal(title, html, [[label, () => done(true), 'primary']]));
    },
  };

  function setBidValue(v) {
    if (!bidState) return;
    v = Math.max(bidState.min, Math.min(bidState.max, v));
    $('#bidBox').value = String(v); $('#bidRange').value = String(v);
    updateBidLabel();
  }
  function updateBidLabel() {
    if (!bidState) return;
    const b = $('#btnBid'), v = $('#bidBox').value;
    b.disabled = !bidState.canBid;
    if (!bidState.canBid) b.textContent = bidState.verb === 'Buy' ? "Can't afford" : 'No valid bid';
    else b.textContent = `${bidState.verb} ${v}`;
  }

  function flash(t) {
    const p = $('#prompt');
    const old = $('#promptText').textContent;
    $('#promptText').textContent = t;
    p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash');
    setTimeout(() => { if ($('#promptText').textContent === t) $('#promptText').textContent = old; }, 2000);
  }

  function feed(text, p = 0, cls = '') {
    if (!G) return;
    G.feed.unshift({ text, p, cls });
    if (G.feed.length > 40) G.feed.pop();
    renderFeed();
  }

  // ---- modal ---------------------------------------------------------------
  function openModal(title, html, buttons) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    const bw = $('#modalButtons'); bw.innerHTML = '';
    for (const [label, fn, kind = 'secondary'] of buttons) {
      const b = document.createElement('button');
      b.className = 'btn ' + kind;
      b.textContent = label;
      b.onclick = () => { closeModal(); fn && fn(); };
      bw.appendChild(b);
    }
    $('#modal').hidden = false;
    const primary = bw.querySelector('.primary') || bw.querySelector('button');
    if (primary) primary.focus({ preventScroll: true });
  }
  function closeModal() { $('#modal').hidden = true; }

  // =========================================================================
  // Rendering
  // =========================================================================
  function pcard(c, { tag = 'div', lg = false, cls = '' } = {}) {
    const a = artist(c), t = typeOf(c);
    return `<${tag} class="pcard a${a}${lg ? ' lg' : ''} ${cls}" data-card="${c}" title="${esc(cardName(c))}" aria-label="${esc(cardName(c))}">
      <span class="who">${ARTISTS[a]}</span><span class="abbr">${ABBR[a]}</span><span class="ico">${IC.AUCTION[t]}</span><span class="kind">${SHORT[t]}</span></${tag}>`;
  }
  const chipsHTML = counts => counts.map((n, a) => (a && n ? `<span class="chip a${a}" title="${ARTISTS[a]} bought this round"><i></i>${n}</span>` : '')).join('');
  function boughtCounts(p) {
    const n = [0, 0, 0, 0, 0, 0];
    for (let c = 1; c <= 70; c++) if (G.cards[c] === p + 4) n[artist(c)]++;
    return n;
  }
  function pillHTML(p) {
    const l = G.labels[p];
    if (l === '' || l === undefined) return '';
    const cls = l === 'Pass' ? 'pass' : (G.winner === p ? 'win' : '');
    return `<span class="bid-pill ${cls}">${esc(l)}</span>`;
  }

  function buildStatic() {
    $('.logo').innerHTML = IC.LOGO;
    $('#btnHistory').innerHTML = IC.UI.history;
    $('#btnRules').innerHTML = IC.UI.rules;
    $('#btnMenu').innerHTML = IC.UI.menu;
    $('#opponents').innerHTML = [1, 2, 3].map(p => `<article class="opp p${p}" id="opp${p}"></article>`).join('');
    $('#market').innerHTML = [1, 2, 3, 4, 5].map(a => `<article class="artist a${a}" id="art${a}">
      <div class="art"><img src="img/art${a}.png" alt="${ARTISTS[a]} painting"><span class="rank" hidden></span></div>
      <div class="meta"><div class="aname">${ARTISTS[a]}</div><div class="pips"></div><div class="pips-label"></div>
      <div class="values"></div><div class="worth"></div></div></article>`).join('');
  }

  // Current standing of each artist this round (same tie-break as scoring).
  function standings() {
    const n = [0, 0, 0, 0, 0, 0], pend = [0, 0, 0, 0, 0, 0];
    for (let c = 1; c <= 70; c++) {
      const v = G.cards[c];
      if (v >= 5 && v <= 9) n[artist(c)]++;
      if (v === 11) pend[artist(c)]++;
    }
    // paintings on the block count too: they're played whoever ends up buying them
    const t = a => n[a] + pend[a];
    const order = [1, 2, 3, 4, 5].filter(a => t(a) > 0).sort((x, y) => t(y) - t(x) || x - y).slice(0, 3);
    return { n, pend, order };
  }

  function render() {
    if (!G) return;
    // rounds tracker
    $('#rounds').innerHTML = [1, 2, 3, 4].map(r => {
      const cls = G.over ? 'done' : r < G.round ? 'done' : r === G.round ? 'now' : '';
      return `<li class="${cls}"><span class="long">Round </span>${r}</li>`;
    }).join('');
    // opponents
    for (let p = 1; p <= 3; p++) {
      const el = $('#opp' + p), n = handOf(p).length;
      el.classList.toggle('turn', G.turn === p && !G.over);
      const sellerTag = G.auction && G.auction.seller === p ? '<span class="tag">Selling</span>' : '';
      el.innerHTML = `<div class="avatar p${p}">${NAMES[p][0]}</div>
        <div><div class="name">${NAMES[p]} ${sellerTag}</div>
        <div class="sub">${IC.UI.cards}${n}<span class="long">&nbsp;in hand</span>${G.over ? ` · <b>${G.money[p]}</b>` : ''}</div></div>
        ${pillHTML(p)}
        <div class="chips">${chipsHTML(boughtCounts(p))}</div>`;
    }
    // me
    $('#myMoney').textContent = `$${G.money[4]}`;
    $('#myChips').innerHTML = chipsHTML(boughtCounts(4));
    const lab = G.labels[4];
    const ml = $('#myLabel');
    ml.textContent = lab || '';
    ml.className = 'bid-pill' + (lab === 'Pass' ? ' pass' : G.winner === 4 ? ' win' : '');
    $('#dock').classList.toggle('turn', G.turn === HUMAN && !G.over);
    // market
    const st = standings(), prizes = [30, 20, 10];
    for (let a = 1; a <= 5; a++) {
      const el = $('#art' + a);
      let pips = '';
      for (let i = 0; i < 5; i++) {
        const cls = i < st.n[a] ? 'on' : i < st.n[a] + st.pend[a] ? 'pending' : '';
        pips += `<span class="pip ${cls}${i === 4 ? ' last' : ''}"></span>`;
      }
      el.querySelector('.pips').innerHTML = pips;
      el.querySelector('.pips-label').textContent = `${st.n[a]} of 5 played`;
      const rank = st.order.indexOf(a), rk = el.querySelector('.rank');
      const showRank = rank >= 0 && !G.over;
      rk.hidden = !showRank;
      if (showRank) { rk.textContent = G.scored ? `+${G.tv[G.round][a] || prizes[rank]}` : `${['1st', '2nd', '3rd'][rank]}`; rk.className = 'rank r' + (rank + 1); }
      let vals = '', tot = 0;
      for (let r = 1; r <= 4; r++) {
        const shown = r < G.round || (r === G.round && G.scored) || G.over;
        const v = shown ? G.tv[r][a] : 0;
        tot += v;
        vals += `<span class="${v ? 'has' : ''}${r === G.round && !G.over ? ' now' : ''}" title="Round ${r}">${shown ? (v || '–') : `R${r}`}</span>`;
      }
      el.querySelector('.values').innerHTML = vals;
      el.querySelector('.worth').innerHTML = tot ? `Value <b>${tot}</b>` : 'No value yet';
    }
    renderAuction();
    renderHand();
    renderPrompt();
    syncLayout();
  }

  function renderPrompt() {
    if (!G) return;
    const w = $('#promptWho');
    let t = G.over ? 'Game over' : `Round ${G.round}`;
    if (!G.over && G.turn) t += G.turn === HUMAN ? ' · Your turn' : ` · ${NAMES[G.turn]}'s turn`;
    w.textContent = t;
    $('#prompt').classList.toggle('your-turn', G.turn === HUMAN && !G.over && document.body.classList.contains('mode-card'));
  }

  const RULE_TEXT = {
    2: 'Everyone bids once, in secret. Highest bid wins; ties go to the auctioneer, then clockwise.',
    3: 'The auctioneer names a price. Going clockwise, each player may buy it. If nobody does, the auctioneer must.',
    4: 'Starting left of the auctioneer, each player gets one chance to raise. The auctioneer goes last.',
    5: 'Anyone may raise. The painting goes to the highest bid nobody will top.',
    lone: 'A double needs a second painting by the same artist. The first player in turn order to add one runs the auction and keeps all the money.',
  };

  function renderAuction() {
    const A = G && G.auction, el = $('#auction');
    el.classList.toggle('active', !!A);
    if (!A) return;
    $('#auctionLots').innerHTML = A.cards.map(c => pcard(c, { lg: true })).join('');
    $('#auctionTitle').textContent = (A.cards.length > 1 ? 'Double ' : '') + ARTISTS[artist(A.cards[0])];
    // "Fixed Price auction": the word "auction" is dropped on narrow screens to keep one line
    $('#auctionType').innerHTML = A.type.endsWith(' auction') ? `${esc(A.type.slice(0, -8))}<span class="long"> auction</span>` : esc(A.type);
    $('#auctionSeller').textContent = A.seller === HUMAN ? 'You are the auctioneer' : `Auctioneer: ${NAMES[A.seller]}`;
    $('#auctionRule').textContent = RULE_TEXT[A.kind] || '';
    $('#highLabel').textContent = A.highLabel || 'High bid';
    $('#highAmount').textContent = A.high === null || A.high === undefined ? '—' : A.high;
    $('#highBy').textContent = A.highBy || '';
    $('#myCash').textContent = `You have $${G.money[4]}`;
    $('.auction-high').hidden = A.kind === 'lone' && (A.high === null || A.high === undefined);
  }

  // Can card c be chosen in the current hand mode?
  function eligible(c) {
    if (!handMode || !handResolve || !G || G.cards[c] !== HUMAN) return false;
    if (handMode.kind === 'play') return true;
    return artist(c) === handMode.artist && typeOf(c) !== 1 && c !== handMode.exclude;
  }

  function renderHand() {
    const h = $('#hand');
    if (!G) { h.innerHTML = ''; return; }
    const cards = sortCards(handOf(HUMAN));
    h.classList.toggle('choosing', !!handMode);
    // phone layout: keep the hand to 2 rows (6 or 7 across), or 3 rows of 6 for 15+ paintings
    const n = cards.length, cols = n <= 12 ? 6 : n <= 14 ? 7 : 6;
    h.style.setProperty('--cols', cols);
    if (!cards.length) { h.innerHTML = '<div class="hand-empty">No paintings in hand.</div>'; updateHandActions(); return; }
    h.innerHTML = cards.map(c => {
      const ok = eligible(c);
      const cls = [c === selected ? 'selected' : '', hintCards[0] === c ? 'hint' : '', hintCards[1] === c ? 'hint2' : '',
        handMode && c === handMode.exclude ? 'locked' : ''].join(' ');
      return pcard(c, { tag: 'button', cls }).replace('<button ', `<button ${ok ? '' : 'disabled '}`);
    }).join('');
    h.querySelectorAll('button.pcard').forEach(b => {
      const c = +b.dataset.card;
      // Ignore events from replaced elements, ineligible cards, and the tail end of the
      // double-click that started this choice (a double-click is click, click, dblclick).
      const live = () => b.isConnected && eligible(c) && performance.now() - handModeAt > 350;
      b.onclick = () => {
        if (!live()) return;
        if (selected === c) { choose(c); return; }
        // select in place: re-rendering here would swap the element under the mouse and
        // swallow the second click of a double-click
        selected = c;
        h.querySelectorAll('button.pcard.selected').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
        updateHandActions();
      };
      b.ondblclick = () => { if (live()) choose(c); };
    });
    updateHandActions();
  }
  function choose(c) {
    if (!eligible(c)) return;
    const r = handResolve; hintCards = []; r(c);
  }
  function updateHandActions() {
    const play = $('#btnPlay');
    play.hidden = !handMode || !selected;
    if (handMode && selected) play.textContent = handMode.kind === 'play' ? `Auction ${ARTISTS[artist(selected)]}` : 'Add as second painting';
    play.onclick = () => { if (selected) choose(selected); };
    $('#btnCardHint').hidden = !(handMode && handMode.kind === 'play');
    $('#btnNewGameDock').hidden = !(G && G.over);
    if (!handMode) { $('#btnNoSecond').hidden = true; $('#btnCancelDouble').hidden = true; }
  }

  function renderFeed() {
    $('#feed').innerHTML = G.feed.map(f => `<li class="${f.cls}" style="--dot: var(--p${f.p || 0}, var(--line))">${esc(f.text)}</li>`).join('');
  }

  function setAuction(seller, cards, kind, type) {
    G.auction = { seller, cards, kind, type, high: null, highBy: '', highLabel: 'High bid' };
    G.winner = 0;
  }
  function setHigh(amount, by, label = 'High bid') {
    if (!G.auction) return;
    G.auction.high = amount; G.auction.highBy = by || ''; G.auction.highLabel = label;
    render();
  }
  function setLabel(p, t) { G.labels[p] = t === '' ? '' : String(t); }
  function clearLabels() { G.labels = ['', '', '', '', '']; G.winner = 0; }

  // =========================================================================
  // Game flow
  // =========================================================================
  async function runGame() {
    let turn = 1 + Math.floor(4 * G.rng());
    for (let round = 1; round <= 4; round++) {
      G.round = round; G.scored = false; G.endMsg = '';
      turn = next(turn);
      for (let c = 1; c <= 70; c++) if (G.cards[c] >= 5 && G.cards[c] <= 9) G.cards[c] = 10;
      deal(round);
      G.auction = null; clearLabels();
      feed(`Round ${round} begins${round > 1 && round < 4 ? ' — everyone draws 4 paintings' : ''}.`, 0, 'round');
      render();
      const ender = await playRound(turn);
      G.turn = ender;
      G.endMsgs[round] = G.endMsg || `Round ${round} is over.`;
      const S = scoreRound();
      G.auction = null; clearLabels(); render();
      ui.status(G.endMsg || `Round ${round} is over.`);
      feed(G.endMsg || `Round ${round} is over.`, ender, 'round');
      if (round < 4) await ui.dialog(`Round ${round} results`, roundSummaryHTML(S), `Start round ${round + 1}`);
      else endGame(S);
      turn = ender;
    }
  }

  async function playRound(p) {
    for (;;) {
      if (handOf(p).length === 0) {
        if (!anyCards()) { G.endMsg = 'Nobody has any paintings left, so the round is over.'; return prev(p); }
        p = next(p); continue;
      }
      G.turn = p; G.auction = null; clearLabels(); render();
      const res = p === HUMAN ? await humanTurn() : await aiTurn(p);
      if (res.ended) return res.ended;
      p = next(res.auctioneer);
    }
  }

  function endRoundWith(p, card, second) {
    G.cards[card] = 9; if (second) G.cards[second] = 9;
    const what = typeOf(card) === 1 ? (second ? 'a double ' : 'a lone double ') : 'a ';
    G.endMsg = `${who(p)} ${p === HUMAN ? 'end' : 'ends'} the round by playing ${what}${ARTISTS[artist(card)]}.`;
    const a = ARTISTS[artist(card)];
    const an = w => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);
    const how = typeOf(card) !== 1 ? an(`${KIND[typeOf(card)].toLowerCase()} ${a}`)
      : second ? `a double ${a} with ${an(`${KIND[typeOf(second)].toLowerCase()} ${a}`)}` : `a lone double ${a}`;
    G.hist[G.round][p] += `Ended the round by playing ${how} (5th ${a})\n`;
    return { ended: p };
  }

  async function aiTurn(p) {
    ui.status(`${NAMES[p]} is choosing a painting…`);
    let { card, second } = AI.pickACard(p);
    const out = AI.countOut(), a = artist(card);
    if (out[a] === 4 && second) second = 0;
    if (!second && out[a] === 4) return endRoundWith(p, card, 0);
    if (second && out[a] === 3) return endRoundWith(p, card, second);
    if (typeOf(card) === 1 && !second) return loneDouble(p, card);
    return auction(p, card, second);
  }

  function lowFixedWarning(card, dbl) {
    let low = 0;
    for (let r = 1; r <= G.round; r++) low += G.tv[r][artist(card)];
    return dbl ? (G.money[4] < 2 * low || G.money[4] <= 10) : (G.money[4] < low || G.money[4] <= 5);
  }

  async function humanTurn() {
    for (;;) {
      G.auction = null; render();
      ui.status('Your turn — choose a painting to auction.');
      const card = await ui.card({ kind: 'play' });
      const a = artist(card), out = AI.countOut();
      if (out[a] === 4) {
        if (!(await ui.confirm(`This is the 5th ${ARTISTS[a]} this round, so playing it ends the round without an auction. End the round?`, 'End round'))) continue;
        return endRoundWith(HUMAN, card, 0);
      }
      if (typeOf(card) === 3 && lowFixedWarning(card, false) &&
          !(await ui.confirm('The most you can charge for this fixed-price painting is low (you can only set a price you can afford). Auction it anyway?', 'Auction it'))) continue;
      if (typeOf(card) !== 1) return auction(HUMAN, card, 0);

      // a double: choose a second painting, play it alone, or cancel
      setAuction(HUMAN, [card], 'lone', 'Double — choose a second painting'); render();
      for (;;) {
        const partners = handOf(HUMAN).filter(c => artist(c) === a && typeOf(c) !== 1);
        ui.status(partners.length
          ? `Double ${ARTISTS[a]}: double-click another ${ARTISTS[a]} to auction with it (its auction type is used), or auction the double alone.`
          : `You have no other ${ARTISTS[a]} to pair with this double. Auction it alone, or cancel and choose another painting.`);
        const s = await ui.card({ kind: 'second', artist: a, exclude: card, canCancel: true, noneLabel: 'Auction double alone' });
        if (s === 'cancel') break;
        if (s === 'none') {
          const A = ARTISTS[a];
          const msg = out[a] === 3
            // the double is the 4th of this artist, so a partner card would be the 5th
            ? `This double is the 4th ${A} this round. Going clockwise, each player may add a ${A}, but that would be the 5th ${A}, so the round would end immediately: no auction, nobody is paid, and both paintings just count toward ${A}'s ranking. You lose your turn either way. If nobody adds one, you get the double for free.`
            : `Auction the ${A} double by itself? Going clockwise, each player may add a ${A} to it. The first to do so runs the auction and keeps all the money, and you lose your turn. If nobody adds one, you get the double for free.`;
          if (!(await ui.confirm(msg, 'Play double alone', 'Go back'))) continue;
          return loneDouble(HUMAN, card);
        }
        if (typeof s !== 'number' || artist(s) !== a || typeOf(s) === 1 || s === card) continue; // defensive
        if (out[a] === 3) {
          if (!(await ui.confirm(`These would be the 4th and 5th ${ARTISTS[a]} this round, which ends the round without an auction. End the round?`, 'End round'))) continue;
          return endRoundWith(HUMAN, card, s);
        }
        if (typeOf(s) === 3 && lowFixedWarning(s, true) &&
            !(await ui.confirm('The most you can charge for these fixed-price paintings is low. Auction them anyway?', 'Auction them'))) continue;
        return auction(HUMAN, card, s);
      }
    }
  }

  // A double played without a second painting: each other player, in turn
  // order, may add one and run the auction themselves (German rules: the person
  // adding the second card receives the whole price).
  async function loneDouble(seller, card) {
    const a = artist(card), out = AI.countOut();
    setAuction(seller, [card], 'lone', 'Lone double');
    const lead = `${who(seller)} ${seller === HUMAN ? 'play' : 'plays'} a lone double ${ARTISTS[a]}.`;
    feed(lead, seller);
    ui.status(lead); render();
    for (let y = next(seller); y !== seller; y = next(y)) {
      let second = 0;
      if (y === HUMAN) {
        G.turn = HUMAN;
        for (;;) {
          const partners = handOf(HUMAN).filter(c => artist(c) === a && typeOf(c) !== 1);
          ui.status(partners.length
            ? (out[a] === 3
              ? `${lead} It's the 4th ${ARTISTS[a]}, so adding one of yours would be the 5th and end the round at once (no auction, nobody is paid). Double-click a ${ARTISTS[a]} to do that, or pass.`
              : `${lead} Double-click one of your ${ARTISTS[a]} paintings to add it. You'd run the auction and keep all the money. Or pass.`)
            : `${lead} You have no ${ARTISTS[a]} to add, so you have to pass.`);
          const s = await ui.card({ kind: 'second', artist: a, noneLabel: partners.length ? "Don't add one" : 'Pass' });
          if (s === 'none') break;
          if (typeof s !== 'number' || artist(s) !== a || typeOf(s) === 1) continue; // defensive
          if (out[a] === 3 && !(await ui.confirm(`That would be the 5th ${ARTISTS[a]}, which ends the round immediately. There's no auction, so nobody is paid for these paintings. End the round?`, 'End round'))) continue;
          if (out[a] !== 3 && typeOf(s) === 3 && lowFixedWarning(s, true) &&
              !(await ui.confirm('The most you can charge for these fixed-price paintings is low. Auction them anyway?', 'Auction them'))) continue;
          second = s; break;
        }
      } else {
        second = AI.chooseSecond(y, card);
      }
      if (second) {
        G.turn = y;
        const msg = `${who(y)} ${y === HUMAN ? 'complete' : 'completes'} the double with ${KIND[typeOf(second)].toLowerCase()} ${ARTISTS[a]}.`;
        feed(msg, y);
        if (out[a] === 3) {
          const r = endRoundWith(y, card, second);
          G.endMsg = `${msg} That ends the round.`;
          return r;
        }
        return auction(y, card, second, msg + ' ');
      }
    }
    G.cards[card] = seller + 4;
    G.hist[G.round][seller] += `Received lone double ${ARTISTS[a]} for free.\n`;
    G.turn = seller;
    setHigh(0, 'Nobody added a painting', 'Free');
    const msg = `Nobody added a painting, so ${seller === HUMAN ? 'you get' : NAMES[seller] + ' gets'} the ${ARTISTS[a]} double for free.`;
    feed(msg, seller);
    ui.status(msg);
    render();
    await ui.ok();
    return { auctioneer: seller };
  }

  // Run an auction. Returns {auctioneer}.
  async function auction(seller, card, second, prefix = '') {
    if (second && (second === card || typeOf(second) === 1 || artist(second) !== artist(card)))
      throw new Error(`Invalid double: ${cardName(card)} + ${cardName(second)}`);
    const a = artist(card), P = AI.auctionParams(card, second);
    const cards = second ? [card, second] : [card];
    G.turn = seller;
    // AI valuations are computed with the paintings still in hand, as in the original.
    const bids = AI.aiBids(card, second, seller);
    G.cards[card] = 11; if (second) G.cards[second] = 11;
    setAuction(seller, cards, P.aucType, AUC[P.aucType] + ' auction');
    clearLabels(); render();
    const tag = (second ? 'Double ' : '') + ARTISTS[a];
    const humanMax = Math.min(P.cap, G.money[4]);
    const prevValue = P.maxPrice - 30;
    const defBid = Math.min(humanMax, P.dbl ? 2 * prevValue : prevValue);
    const hint = { card, second, seller };
    const sellerTxt = seller === HUMAN ? 'You put' : `${NAMES[seller]} puts`;
    let buyer = seller, price = 0, extra = '';

    switch (P.aucType) {
      case 2: { // hidden
        setHigh(null, '', 'Sealed bids');
        ui.status(`${prefix}${sellerTxt} ${tag} up for a hidden auction. Enter your secret bid.`);
        const b = await ui.bid({ min: 0, max: humanMax, def: defBid, hint });
        bids[4] = b || 0;
        let best = 0; buyer = 0;
        for (let k = 0, g = seller; k < 4; k++, g = next(g)) if (bids[g] > best) { best = bids[g]; buyer = g; }
        if (!buyer) buyer = seller;
        price = best;
        for (let p = 1; p <= 4; p++) setLabel(p, bids[p] ? bids[p] : 'Pass');
        if (buyer === HUMAN) {
          let nh = 0;
          for (let x = 1; x <= 3; x++) if (bids[x] > bids[nh]) nh = x;
          if (nh) extra = ` Next best: ${NAMES[nh]} with ${bids[nh]}.`;
        }
        break;
      }
      case 3: { // fixed price
        let fp;
        if (seller === HUMAN) {
          ui.status(`${prefix}Set a fixed price for ${tag}. You can't set more than your own money.`);
          setHigh(null, '', 'Price');
          fp = await ui.bid({ min: 1, max: G.money[4], def: Math.max(1, defBid), verb: 'Set price', canPass: false, hint });
          setHigh(fp, '', 'Price');
          buyer = 0;
          for (let x = 1; x <= 3 && !buyer; x++) { if (bids[x] >= fp) buyer = x; else setLabel(x, 'Pass'); }
          if (!buyer) { buyer = HUMAN; extra = ' Nobody bought it, so you had to.'; }
        } else {
          fp = AI.aiFixedPrice(seller, card, second);
          setHigh(fp, '', 'Price');
          buyer = 0;
          const passed = [];
          for (let x = next(seller); x !== seller && !buyer; x = next(x)) {
            if (x === HUMAN) {
              const can = fp <= G.money[4];
              const passTxt = passed.length ? `${listNames(passed)} passed. ` : '';
              ui.status(`${prefix}${NAMES[seller]} offers ${tag} for ${fp}. ${passTxt}` + (can ? 'Buy it?' : "You can't afford it."));
              render();
              const r = await ui.bid({ min: can ? fp : 1, max: can ? fp : 0, def: fp, verb: 'Buy', fixed: true, hint });
              if (r !== null) buyer = HUMAN; else setLabel(HUMAN, 'Pass');
            } else if (bids[x] >= fp) buyer = x;
            else { setLabel(x, 'Pass'); passed.push(NAMES[x]); }
          }
          if (!buyer) { buyer = seller; extra = ` Nobody bought it, so ${NAMES[seller]} had to.`; }
        }
        price = fp;
        setLabel(buyer, fp);
        break;
      }
      case 4: { // once around: each player once, starting left of the auctioneer
        let high = 0, hp = 0;
        for (let x = next(seller), k = 0; k < 4; k++, x = next(x)) {
          if (x === HUMAN) {
            setHigh(hp ? high : null, hp ? NAMES[hp] : 'No bids yet');
            ui.status(`${prefix}${sellerTxt} ${tag} up once around. ${hp ? `${NAMES[hp]} leads with ${high}.` : 'Nobody has bid yet.'} Raise or pass — you only get one chance.`);
            const b = await ui.bid({ min: high + 1, max: humanMax, def: high + 1, hint });
            if (b !== null && b > high) { high = b; hp = HUMAN; setLabel(HUMAN, b); }
            else setLabel(HUMAN, 'Pass');
          } else if (bids[x] > high) {
            // the player just before the auctioneer, and the auctioneer, only raise by 1
            high = (x === seller || next(x) === seller) ? high + 1 : bids[x];
            hp = x; setLabel(x, high);
          } else setLabel(x, 'Pass');
          setHigh(hp ? high : null, hp ? who(hp) : 'No bids yet');
        }
        buyer = hp || seller; price = high;
        break;
      }
      case 5: { // open
        let cm = 0, sm = 0;
        for (let x = 1; x <= 3; x++) {
          if (bids[x] === bids[cm]) sm = x;
          if (bids[x] > bids[cm]) { sm = cm; cm = x; }
          if (bids[x] > bids[sm] && x !== cm) sm = x;
        }
        const tops = [1, 2, 3].filter(x => bids[x] === bids[cm]);
        let final;
        if (tops.length > 1) { cm = tops[Math.floor(tops.length * G.rng())]; final = bids[cm]; }
        else { cm = tops[0]; final = bids[sm] + 1; if (final === bids[cm] - 1) final = bids[cm]; }
        if (final === 0) cm = seller;
        for (let x = 1; x <= 3; x++) {
          const shown = x === cm ? final : (bids[x] >= final && final !== 0 ? final - 1 : bids[x]);
          setLabel(x, shown || 'Pass');
        }
        let curMin = final + 1;
        ui.status(`${prefix}${sellerTxt} ${tag} up for an open auction. ${final ? `${NAMES[cm]} leads with ${final}.` : 'Nobody else has bid.'} Raise or pass.`);
        for (;;) {
          setHigh(final === 0 && curMin === 1 ? null : curMin - 1, final === 0 && curMin === 1 ? 'No bids yet' : NAMES[cm]);
          const b = await ui.bid({ min: curMin, max: humanMax, def: curMin, hint });
          const bv = b || 0;
          if (bids[cm] <= bv) { buyer = bv === 0 ? seller : HUMAN; price = bv; break; }
          if (bv === 0) { buyer = cm; price = curMin - 1; setLabel(HUMAN, 'Pass'); break; }
          setLabel(HUMAN, bv);
          curMin = bv + 2;
          if (curMin === bids[cm]) curMin = bids[cm] + 1;
          setLabel(cm, curMin - 1);
          ui.status(`${NAMES[cm]} raises to ${curMin - 1}. Raise again or pass.`);
        }
        if (buyer === HUMAN) setLabel(HUMAN, price);
        break;
      }
    }

    // settle
    G.money[buyer] -= price;
    if (buyer !== seller) G.money[seller] += price;
    G.flow[G.round][buyer].spent += price;
    if (buyer !== seller) G.flow[G.round][seller].earned += price;
    G.cards[card] = buyer + 4; if (second) G.cards[second] = buyer + 4;
    record(buyer, seller, price, tag);
    G.winner = buyer;
    const free = price === 0 && buyer === seller;
    setHigh(price, `${who(buyer)} ${buyer === HUMAN ? 'win' : 'wins'}`, free ? 'No bids' : 'Sold');
    let msg;
    if (free) msg = `Nobody bid, so ${buyer === HUMAN ? 'you get' : NAMES[buyer] + ' gets'} ${tag} for free.`;
    else if (buyer === seller) msg = `${who(buyer)} ${buyer === HUMAN ? 'buy' : 'buys'} ${seller === HUMAN ? 'your' : 'their'} own ${tag} for ${price} (paid to the bank).`;
    else msg = `${who(buyer)} ${buyer === HUMAN ? 'buy' : 'buys'} ${tag} from ${seller === HUMAN ? 'you' : NAMES[seller]} for ${price}.`;
    msg += extra;
    feed(msg, buyer);
    ui.status(prefix + msg);
    render();
    await ui.ok();
    return { auctioneer: seller };
  }

  // EndOfRound: rank artists (ties go to the leftmost), pay out bought paintings.
  function scoreRound() {
    const R = G.round, C = G.cards;
    const numout = [0, 0, 0, 0, 0, 0];
    for (let x = 1; x <= 5; x++) numout[x] = 0.5 - x / 10;
    for (let c = 1; c <= 70; c++) if (C[c] >= 5 && C[c] <= 9) numout[artist(c)] += 1;
    const order = [1, 2, 3, 4, 5].sort((x, y) => numout[y] - numout[x]);
    const award = [30, 20, 10], placings = [];
    for (let k = 0; k < 3; k++) {
      const a = order[k];
      if (numout[a] >= 1) { G.tv[R][a] = award[k]; placings.push(a); }
    }
    const total = a => { let s = 0; for (let r = 1; r <= R; r++) s += G.tv[r][a]; return s; };
    const payout = [0, 0, 0, 0, 0], bought = [null, [], [], [], []];
    for (let c = 1; c <= 70; c++) {
      if (C[c] > 4 && C[c] < 9) {
        const p = C[c] - 4, v = G.tv[R][artist(c)] ? total(artist(c)) : 0;
        bought[p].push([artist(c), v]);
        if (v) { G.money[p] += v; payout[p] += v; G.flow[R][p].bank += v; record(0, p, v, ARTISTS[artist(c)]); }
      }
    }
    for (let p = 1; p <= 4; p++) G.hist[R][p] += `Round ${R} total: ${G.money[p]}\n`;
    G.scored = true;
    return { placings, payout, bought, total };
  }

  const sgn = n => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  const sgnCls = n => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
  const moneyCell = (n, sub = '', extra = '') => `<td class="num ${extra}"><span class="${sgnCls(n)}">${sgn(n)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</td>`;
  const FLOW_HEAD = '<tr><th>Player</th><th class="num">Auctioned</th><th class="num">Paid</th><th class="num">Sold to bank</th><th class="num">Net</th></tr>';
  const FLOW_NOTE = `<p class="fineprint"><b>Auctioned</b>: money other players paid you for paintings you auctioned. <b>Paid</b>: what you spent buying paintings, including your own (paid to the bank). <b>Sold to bank</b>: what your bought paintings sold for at the end of the round.</p>`;

  function roundSummaryHTML(S) {
    const pl = S.placings.map((a, i) => `<span class="chip a${a}"><i></i>${['1st', '2nd', '3rd'][i]} ${ARTISTS[a]} · +${[30, 20, 10][i]} → ${S.total(a)}</span>`).join('');
    const rows = [4, 1, 2, 3].map(p => {
      const f = G.flow[G.round][p];
      const g = {};
      for (const [a, v] of S.bought[p]) { g[a] = g[a] || [0, v]; g[a][0]++; }
      const items = Object.entries(g).map(([a, [n, v]]) => `${n > 1 ? n + '× ' : ''}${ARTISTS[a]} @${v}`).join(', ');
      return `<tr class="${p === HUMAN ? 'mine' : ''}"><td>${who(p)}</td>
        ${moneyCell(f.earned)}${moneyCell(-f.spent)}${moneyCell(f.bank, items)}${moneyCell(f.earned - f.spent + f.bank, '', 'net')}</tr>`;
    }).join('');
    return `<p>${esc(G.endMsg)}</p><div class="placings">${pl}</div>
      <h3>Round ${G.round} money</h3>
      <table class="table flows">${FLOW_HEAD}${rows}</table>${FLOW_NOTE}
      ${G.round < 4 ? `<p style="margin-top:12px">You now have <b>$${G.money[4]}</b>. Other players' money stays hidden until the end.</p>` : ''}`;
  }

  // Whole-game totals: where each player's money came from over all four rounds.
  function gameSummaryHTML() {
    const tot = p => {
      const t = { earned: 0, spent: 0, bank: 0 };
      for (let r = 1; r <= 4; r++) { const f = G.flow[r][p]; t.earned += f.earned; t.spent += f.spent; t.bank += f.bank; }
      return t;
    };
    const order = [1, 2, 3, 4].sort((x, y) => G.money[y] - G.money[x]);
    const rows = order.map(p => {
      const t = tot(p), net = t.earned - t.spent + t.bank;
      return `<tr class="${p === HUMAN ? 'mine' : ''}"><td>${who(p)}</td>
        ${moneyCell(t.earned)}${moneyCell(-t.spent)}${moneyCell(t.bank)}${moneyCell(net, `$100 → $${G.money[p]}`, 'net')}</tr>`;
    }).join('');
    const per = p => [1, 2, 3, 4].map(r => { const f = G.flow[r][p]; return sgn(f.earned - f.spent + f.bank); }).join(' / ');
    const byRound = [4, 1, 2, 3].map(p => `<tr class="${p === HUMAN ? 'mine' : ''}"><td>${who(p)}</td><td class="num">${per(p)}</td></tr>`).join('');
    return `<table class="table flows">${FLOW_HEAD}${rows}</table>
      <h3>Net by round (1 / 2 / 3 / 4)</h3>
      <table class="table">${byRound}</table>`;
  }

  // Round-by-round money breakdown: earned selling at auction, spent buying, bank sales.
  function roundsBreakdownHTML() {
    let rows = '';
    for (let r = 1; r <= 4; r++) {
      rows += `<tr class="round-head"><td colspan="5">Round ${r}</td></tr>`;
      for (const p of [4, 1, 2, 3]) {
        const f = G.flow[r][p];
        rows += `<tr class="${p === HUMAN ? 'mine' : ''}"><td>${who(p)}</td>${moneyCell(f.earned)}${moneyCell(-f.spent)}${moneyCell(f.bank)}${moneyCell(f.earned - f.spent + f.bank, '', 'net')}</tr>`;
      }
    }
    return `<table class="table flows">${FLOW_HEAD}${rows}</table>`;
  }

  // Game log as formatted HTML: one section per round, a block per player.
  function historyHTML() {
    let h = `<p class="log-game">Game ${pad7(G.num)}${G.over ? ` · <b>${esc(G.result)}</b>` : ''}</p>`;
    if (G.over) {
      h += `<h3 class="log-round">Game summary</h3>${gameSummaryHTML()}
        <h3>Round by round</h3>${roundsBreakdownHTML()}${FLOW_NOTE}`;
    }
    for (let r = G.round; r >= 1; r--) { // most recent round first
      h += `<h3 class="log-round">Round ${r}</h3>`;
      if (G.endMsgs[r]) h += `<p class="log-note">${esc(G.endMsgs[r])}</p>`;
      h += '<div class="log-grid">';
      for (const p of [4, 1, 2, 3]) {
        const lines = G.hist[r][p].split('\n').filter(Boolean);
        const items = lines.length ? lines.map(l => {
          const total = /^Round \d+ total:/.test(l), ended = /^Ended the round/.test(l);
          return `<li class="${total ? 'log-total' : ended ? 'log-ended' : ''}">${esc(l.replace(/^Round \d+ total:/, 'Round total:'))}</li>`;
        }).join('') : '<li class="log-none">Nothing yet</li>';
        h += `<section class="log-player"><h4><span class="avatar p${p}">${NAMES[p][0]}</span>${who(p)}</h4><ul>${items}</ul></section>`;
      }
      h += '</div>';
    }
    return h;
  }

  function endGame(S) {
    G.over = true; G.turn = 0; clearLabels(); G.auction = null;
    const best = Math.max(...G.money.slice(1));
    const winners = [1, 2, 3, 4].filter(p => G.money[p] === best);
    G.result = winners.length > 1 ? `Tie: ${winners.map(who).join(' & ')}` : (winners[0] === HUMAN ? 'You win!' : `${NAMES[winners[0]]} wins!`);
    ui.status(`${G.result} Final money — ` + [1, 2, 3, 4].map(p => `${who(p)} ${G.money[p]}`).join(', ') + '.');
    feed(G.result, winners[0], 'round');
    render();
    const rows = [1, 2, 3, 4].sort((x, y) => G.money[y] - G.money[x])
      .map((p, i) => `<tr class="${p === HUMAN ? 'mine' : ''}"><td>${i + 1}</td><td>${who(p)}</td><td class="num">$${G.money[p]}</td></tr>`).join('');
    openModal('Game over', `<div class="winner">${esc(G.result)}</div>
      <table class="table"><tr><th>#</th><th>Player</th><th class="num">Money</th></tr>${rows}</table>
      <h3>Final round</h3>${roundSummaryHTML(S)}
      <h3 class="section">Whole game</h3>${gameSummaryHTML()}`,
      [['View log', () => showHistory(), 'secondary'], ['New game', () => startGame(), 'primary']]);
  }

  function showHistory() {
    openModal('Game log', G ? historyHTML() : '<p>No game in progress.</p>', [['Close', null, 'primary']]);
  }

  // =========================================================================
  // Controls
  // =========================================================================
  function startGame(num) {
    ui.reset();
    token++;
    if (num === undefined) num = Math.floor(10000000 * Math.random());
    G = freshState(num);
    AI.bind(G);
    hintCards = [];
    document.title = `Modern Art · Game ${pad7(num)}`;
    $('#gameNo').textContent = `Game ${pad7(num)}`;
    renderFeed();
    runGame().catch(e => { if (!(e instanceof Abort)) { console.error(e); ui.status('Error: ' + e.message); } });
  }

  function hintCard() {
    if (!G || !handMode || handMode.kind !== 'play') return;
    const rng = G.rng; G.rng = Math.random; // keep the game's random sequence untouched
    const pick = AI.pickACard(HUMAN);
    G.rng = rng;
    if (!pick) return;
    hintCards = [pick.card, pick.second];
    let t = `The AI would auction ${ARTISTS[artist(pick.card)]} (${KIND[typeOf(pick.card)].toLowerCase()})`;
    if (typeOf(pick.card) === 1) t += pick.second ? `, adding the ${KIND[typeOf(pick.second)].toLowerCase()} ${ARTISTS[artist(pick.second)]} outlined in yellow.` : ' as a lone double.';
    else t += ' — outlined in green.';
    ui.status(t);
    renderHand();
  }

  function hintBid() {
    if (!bidState || !bidState.hint) return;
    const { card, second, seller } = bidState.hint;
    const v = AI.bidHint(card, second, seller);
    flashInfo(`The AI's suggested maximum bid here is ${v}.`);
  }
  function flashInfo(t) { $('#promptText').textContent = t; }

  // Paintings per artist and auction type, counted from the actual deck (cards 1–70).
  function deckTableHTML() {
    const n = [];
    for (let a = 0; a <= 5; a++) n.push([0, 0, 0, 0, 0, 0]);
    for (let c = 1; c <= 70; c++) { n[artist(c)][typeOf(c)]++; n[artist(c)][0]++; n[0][typeOf(c)]++; n[0][0]++; }
    const types = [1, 2, 3, 4, 5];
    const head = `<tr><th>Artist</th>${types.map(t => `<th class="num"><span class="deck-ico">${IC.AUCTION[t]}</span>${KIND[t]}</th>`).join('')}<th class="num">Total</th></tr>`;
    const rows = [1, 2, 3, 4, 5].map(a => `<tr><td><span class="chip a${a}"><i></i>${ARTISTS[a]}</span></td>${types.map(t => `<td class="num">${n[a][t]}</td>`).join('')}<td class="num"><b>${n[a][0]}</b></td></tr>`).join('');
    const foot = `<tr class="deck-total"><td>All</td>${types.map(t => `<td class="num">${n[0][t]}</td>`).join('')}<td class="num">${n[0][0]}</td></tr>`;
    return `<table class="table deck">${head}${rows}${foot}</table>
      <p class="fineprint">More paintings of an artist means that artist is more likely to reach five and end a round. Lite Metal has the fewest (12) but wins every tie, while Krypto has the most (16) but loses every tie.</p>`;
  }

  const RULES = `
<p>Buy and sell paintings by five artists. Whoever has the most money after four rounds wins. Everyone starts with $100, and other players' money is kept secret.</p>
<h3>Your turn</h3><p>Auction one painting from your hand. If someone else wins it, they pay you. If you win your own painting, you pay the bank.</p>
<h3>Auction types</h3><ul>
<li><b>Hidden</b>: everyone bids once in secret. Highest wins; ties go to the auctioneer, then the player nearest their left.</li>
<li><b>Fixed price</b>: the auctioneer sets a price (no more than their own money). Going clockwise, each player may buy. If nobody does, the auctioneer must buy it.</li>
<li><b>Once around</b>: starting left of the auctioneer, each player gets one chance to raise. The auctioneer goes last.</li>
<li><b>Open</b>: anyone may raise until nobody will.</li>
<li><b>Double</b>: add a second painting by the same artist (not another double) and sell both together, using the second painting's auction type. If you play it alone, the next players in order may add one. Whoever does runs the auction, keeps all the money, and play continues from them. If nobody does, you get the double for free.</li></ul>
<p>If nobody bids, the auctioneer gets the painting free.</p>
<h3>End of a round</h3><p>The round ends as soon as the 5th painting by one artist is played. That painting isn't auctioned, but it counts. The three artists with the most paintings played this round earn 30, 20 and 10; ties go to the artist further left. Every painting bought this round sells to the bank for its artist's value <i>added up over all rounds</i>, but only if that artist placed this round. The rest are worth nothing.</p>
<p>Hands: 9 paintings in round 1, 4 more in rounds 2 and 3, and none in round 4.</p>
<h3>Reading the board</h3><p>The bars under each artist count paintings played this round; the 5th ends the round. Badges show the current 1st, 2nd and 3rd. Chips show what each player has bought this round.</p>
<h3>Deck distribution</h3>${deckTableHTML()}`;

  function initControls() {
    buildStatic();
    const menu = $('#menu');
    $('#btnMenu').onclick = e => { menu.hidden = !menu.hidden; e.stopPropagation(); };
    document.addEventListener('click', () => { menu.hidden = true; });
    menu.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => {
      menu.hidden = true;
      const cmd = b.dataset.cmd;
      if (cmd === 'new') startGame();
      if (cmd === 'specific') askSpecific();
      if (cmd === 'classic') location.href = 'classic/';
      if (cmd === 'about') openModal('About', `<p><b>Modern Art</b> is Reiner Knizia's auction game.</p>
        <p>This is a port of Gabriel Rocklin's Visual Basic 6 version (v1.1.9, 2005–06). The bidding AI is a 95-40-1 neural network, one per round, trained by backpropagation and then tuned through self-play. The painting-choice AI scores each painting against five goals, using coefficients evolved by a genetic algorithm.</p>
        <p>Doubles follow the original German rule: whoever adds the second painting collects the whole price.</p>
        <h3>Credits</h3>
        <p><b>Modern Art</b> is a board game designed by Reiner Knizia (© Reiner Knizia). The artist paintings and card art come from the published game; all rights belong to Reiner Knizia and the game's publishers.</p>
        <p>This is an <b>unofficial, non-commercial fan project</b> and is not affiliated with or endorsed by the designer or publishers. If you enjoy it, please <a href="https://boardgamegeek.com/boardgame/118/modern-art" target="_blank" rel="noopener">buy the real game</a>.</p>
        <p>Rights holders: to request changes or removal, please <a href="https://github.com/grocklin/modern-art/issues" target="_blank" rel="noopener">open an issue on GitHub</a>.</p>`, [['Close', null, 'primary']]);
    }));
    $('#btnHistory').onclick = showHistory;
    $('#btnRules').onclick = () => openModal('How to play', RULES, [['Got it', null, 'primary']]);
    $('#btnCardHint').onclick = hintCard;
    $('#btnNewGameDock').onclick = () => startGame();
    $('#btnBidHint').onclick = hintBid;
    document.querySelectorAll('.bid-stepper button').forEach(b => b.addEventListener('click', () => {
      setBidValue((parseInt($('#bidBox').value, 10) || 0) + +b.dataset.step);
    }));
    const box = $('#bidBox');
    box.addEventListener('input', () => { box.value = box.value.replace(/\D/g, ''); $('#bidRange').value = box.value || '0'; updateBidLabel(); });
    $('#bidRange').addEventListener('input', e => setBidValue(+e.target.value));
    box.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setBidValue((parseInt(box.value, 10) || 0) + (e.key === 'ArrowUp' ? 1 : -1)); }
      if (e.key === 'Enter' && !$('#btnBid').disabled) $('#btnBid').click();
    });
    document.addEventListener('keydown', e => {
      if (!$('#modal').hidden) return;
      if (e.key === 'Enter' && !$('#btnOk').hidden && document.activeElement !== box) { e.preventDefault(); $('#btnOk').click(); }
    });
    ui.idle();
  }

  function askSpecific() {
    const cur = G ? pad7(G.num) : '';
    openModal('Play a game number', `<p>Every game has a 7-digit number. Enter one to replay the same deal.</p><input id="gnum" inputmode="numeric" maxlength="7" value="${cur}">`, [
      ['Cancel', null, 'secondary'],
      ['Start', () => { const v = parseInt(($('#gnum') || {}).value, 10); if (!isNaN(v) && v >= 0) startGame(v % 10000000); }, 'primary'],
    ]);
    const inp = $('#gnum');
    inp.focus(); inp.select();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') $('#modalButtons .primary').click(); });
  }

  // Keep CSS informed of the dock and sheet heights (the phone layout stacks them).
  ro.observe($('#dock')); ro.observe($('#auction'));
  addEventListener('resize', syncLayout);
  syncLayout();

  window.MA_DEBUG = () => G; // for console inspection
  window.MA_RENDER = () => render();
  initControls();
  startGame();
})();
