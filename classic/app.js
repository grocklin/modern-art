// Modern Art — game flow and UI.
// The VB6 version drove the game from button-click handlers and a GameState
// number; here the same flow is an async turn loop that awaits the human's input.
// All AI decisions come from ai.js (a faithful port of the original routines).

(function () {
  'use strict';
  const AI = window.MA_AI;
  const { artist, typeOf } = AI;
  const NAMES = [null, 'Axel', 'Beatrix', 'Clemens', 'Doris'];
  const ARTISTS = [null, 'Lite Metal', 'Yoko', 'Cristin P', 'Karl Gitter', 'Krypto'];
  const AUC = [null, 'Double', 'Hidden', 'Fixed Price', 'Once Around', 'Open'];
  const HUMAN = 4;
  const $ = s => document.querySelector(s);
  const next = p => (p % 4) + 1;
  const prev = p => ((p + 2) % 4) + 1;

  class Abort extends Error {}

  // ---- seeded RNG (game numbers replay the same deal) ----------------------
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
    const tv = [];
    for (let r = 0; r <= 4; r++) tv.push([0, 0, 0, 0, 0, 0]);
    const hist = [];
    for (let r = 0; r <= 4; r++) hist.push(['', '', '', '', '']);
    return {
      num, rng: mulberry32(num), cards: new Array(71).fill(0), money: [0, 100, 100, 100, 100],
      round: 1, tv, hist, turn: 0, labels: ['', '', '', '', ''], auction: null, over: false,
    };
  }

  const cardName = c => `${ARTISTS[artist(c)]} (${AUC[typeOf(c)]})`;
  const handOf = p => { const h = []; for (let c = 1; c <= 70; c++) if (G.cards[c] === p) h.push(c); return h; };
  const anyCards = () => G.cards.some((v, i) => i > 0 && v >= 1 && v <= 4);
  const pad7 = n => String(n).padStart(7, '0');

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
    const who = b => (b === 0 ? 'the Bank' : NAMES[b]);
    if (seller !== buyer) G.hist[R][seller] += `${tag} sold to ${who(buyer)} for ${price}\n`;
    if (buyer !== 0) G.hist[R][buyer] += `${tag} bought from ${NAMES[seller]} for ${price}\n`;
  }

  // =========================================================================
  // UI primitives
  // =========================================================================
  const ui = {
    pending: null,
    wait(setup) {
      const my = token;
      return new Promise((resolve, reject) => {
        this.pending = { reject };
        setup(v => { if (my !== token) return; this.pending = null; this.idle(); resolve(v); });
      });
    },
    reset() {
      if (this.pending) { this.pending.reject(new Abort()); this.pending = null; }
      closeModal();
      this.idle();
    },
    idle() {
      handMode = null; handResolve = null; selected = 0;
      $('#secondButtons').classList.remove('show');
      setBidControls(false);
      $('#btnOk').disabled = true;
      $('#mnuHintCard').disabled = true;
      $('#mnuHintBid').disabled = true;
      bidHintCtx = null;
      renderHand();
    },
    status(t) { $('#status').textContent = t; },
    ok(label = 'OK') {
      return this.wait(done => {
        const b = $('#btnOk');
        b.textContent = label; b.disabled = false; b.focus();
        b.onclick = () => done(true);
      });
    },
    // Ask the human for an amount. Returns a number, or null for pass.
    bid({ min, max, def, bidLabel = 'Bid', canPass = true, fixed = false, hint = null }) {
      return this.wait(done => {
        bidHintCtx = hint;
        $('#mnuHintBid').disabled = !hint;
        const box = $('#bidBox');
        bidLimits = { min, max };
        const canBid = min <= max;
        box.value = canBid ? String(Math.max(min, Math.min(max, def))) : '';
        setBidControls(true, { canBid, canPass, fixed });
        $('#btnBid').textContent = bidLabel;
        $('#btnBid').onclick = () => {
          const v = parseInt(box.value, 10);
          if (isNaN(v) || v < min) { flashStatus(`Cannot bid below ${min}`); box.value = String(min); return; }
          if (v > max) { flashStatus(`Cannot bid above ${max}`); box.value = String(max); return; }
          done(v);
        };
        $('#btnPass').onclick = () => done(null);
        if (canBid && !fixed) { box.focus(); box.select(); } else $(canBid ? '#btnBid' : '#btnPass').focus();
      });
    },
    // Human picks a painting from hand. mode: {kind:'play'} or {kind:'second', artist, canCancel}
    card(mode) {
      return this.wait(done => {
        handMode = mode; handResolve = done; selected = 0;
        if (mode.kind === 'play') $('#mnuHintCard').disabled = false;
        const sb = $('#secondButtons');
        if (mode.kind === 'second') {
          sb.classList.add('show');
          $('#btnNoSecond').classList.add('on');
          $('#btnCancelDouble').classList.toggle('on', !!mode.canCancel);
          $('#btnNoSecond').onclick = () => done('none');
          $('#btnCancelDouble').onclick = () => done('cancel');
        }
        renderHand();
      });
    },
    confirm(msg, title = 'Modern Art') {
      return this.wait(done => openModal(title, `<p>${msg}</p>`, [['Yes', () => done(true)], ['No', () => done(false)]]));
    },
  };

  let handMode = null, handResolve = null, selected = 0, bidLimits = { min: 0, max: 0 }, bidHintCtx = null;
  let hintCards = [];
  let flashTimer = 0;
  function flashStatus(t) {
    const old = $('#status').textContent;
    ui.status(t);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { if ($('#status').textContent === t) ui.status(old); }, 1800);
  }

  function setBidControls(on, { canBid = true, canPass = true, fixed = false } = {}) {
    $('#bidBox').disabled = !on || !canBid || fixed;
    document.querySelectorAll('.steppers button').forEach(b => { b.disabled = !on || !canBid || fixed; });
    $('#btnBid').disabled = !on || !canBid;
    $('#btnPass').disabled = !on || !canPass;
    if (!on) $('#btnBid').textContent = 'Bid';
  }

  // ---- modal ---------------------------------------------------------------
  function openModal(title, html, buttons) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    const bw = $('#modalButtons'); bw.innerHTML = '';
    for (const [label, fn] of buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => { closeModal(); fn && fn(); };
      bw.appendChild(b);
    }
    $('#modal').hidden = false;
    (bw.querySelector('button') || bw).focus();
  }
  function closeModal() { $('#modal').hidden = true; }

  // =========================================================================
  // Rendering
  // =========================================================================
  function buildBoard() {
    const b = $('#board'); b.innerHTML = '';
    for (let a = 1; a <= 5; a++) {
      const d = document.createElement('div');
      d.className = 'artist';
      d.innerHTML = `<div class="aname">${ARTISTS[a]}</div><img src="img/art${a}.png" alt="${ARTISTS[a]}">
        <div class="count" id="cnt${a}"></div>
        <div class="vals">${[1, 2, 3, 4].map(r => `<div class="val" id="v${a}-${r}"></div>`).join('')}</div>
        <div class="total" id="tot${a}"></div>`;
      b.appendChild(d);
    }
  }

  function render() {
    if (!G) return;
    const C = G.cards, out = AI.countOut();
    for (let p = 1; p <= 4; p++) {
      const el = $('#p' + p);
      el.classList.toggle('turn', G.turn === p && !G.over);
      let name = NAMES[p];
      if (p === HUMAN) name = `Doris (${G.money[4]})`;
      if (G.over) name = `${NAMES[p]} (${G.money[p]})`;
      const lab = G.labels[p];
      el.querySelector('.pname').textContent = lab ? (p === 3 ? `${lab} ${NAMES[p]}` : `${NAMES[p]} ${lab}`) : name;
      const hc = el.querySelector('.handcount');
      if (hc) { const n = handOf(p).length; hc.textContent = n; hc.classList.toggle('empty', n === 0); }
      const bought = el.querySelector('.bought'); bought.innerHTML = '';
      for (let a = 1; a <= 5; a++) {
        let n = 0;
        for (let c = 1; c <= 70; c++) if (C[c] === p + 4 && artist(c) === a) n++;
        if (n) bought.insertAdjacentHTML('beforeend', `<div class="token a${a}" title="${ARTISTS[a]} bought this round">${n}</div>`);
      }
    }
    for (let a = 1; a <= 5; a++) {
      let tot = 0;
      for (let r = 1; r <= 4; r++) {
        const v = G.tv[r][a], cell = $(`#v${a}-${r}`);
        cell.textContent = r < G.round || (r === G.round && G.scored) ? (v || '') : '';
        cell.classList.toggle('current', r === G.round && !G.over);
        tot += v;
      }
      const ended = C.reduce((n, v, i) => n + (i > 0 && v === 9 && artist(i) === a ? 1 : 0), 0);
      $('#cnt' + a).textContent = `Played this round: ${out[a] + ended}`;
      $('#tot' + a).textContent = tot ? `Total value: ${tot}` : '';
    }
    renderAuction();
    renderHand();
  }

  function renderAuction() {
    const A = G && G.auction;
    $('#awArtist').textContent = A ? A.artist : 'Artist';
    $('#awType').textContent = A ? A.type : 'Auction Type';
    $('#awSeller').textContent = A ? A.seller : 'Seller:';
    $('#awHigh').textContent = A ? A.high : 'High:';
    $('#awPics').innerHTML = A && A.cards ? A.cards.map(c => `<img src="img/cards/${artist(c)}-${typeOf(c)}.png" alt="${cardName(c)}" title="${cardName(c)}">`).join('') : '';
  }

  function renderHand() {
    const h = $('#hand'); h.innerHTML = '';
    if (!G) return;
    for (const c of handOf(HUMAN)) {
      const b = document.createElement('button');
      b.className = 'card';
      b.title = cardName(c);
      b.innerHTML = `<img src="img/cards/${artist(c)}-${typeOf(c)}.png" alt="${cardName(c)}">`;
      let ok = false;
      if (handMode && handMode.kind === 'play') ok = true;
      if (handMode && handMode.kind === 'second') ok = artist(c) === handMode.artist && typeOf(c) !== 1 && c !== handMode.exclude;
      if (handMode) b.classList.add(ok ? 'selectable' : 'dim');
      if (c === selected) b.classList.add('selected');
      if (hintCards[0] === c) b.classList.add('hint');
      if (hintCards[1] === c) b.classList.add('hint2');
      if (handMode && c === handMode.exclude) b.classList.add('selected');
      b.disabled = !ok;
      b.onclick = () => {
        if (!handResolve) return;
        if (selected === c) { const r = handResolve; hintCards = []; r(c); return; }
        selected = c;
        ui.status(`${cardName(c)} — click again to ${handMode.kind === 'play' ? 'auction it' : 'add it to the double'}.`);
        renderHand();
      };
      b.ondblclick = () => { if (handResolve && ok) { const r = handResolve; hintCards = []; r(c); } };
      h.appendChild(b);
    }
  }

  function setAuctionPanel(seller, cards, typeLabel, high = 'High:') {
    const c = cards[0];
    G.auction = {
      artist: (cards.length > 1 ? 'Double ' : '') + ARTISTS[artist(c)],
      type: typeLabel, seller: 'Seller: ' + NAMES[seller], high, cards,
    };
  }
  function setHigh(t) { if (G.auction) G.auction.high = t; render(); }
  function setLabel(p, t) { G.labels[p] = t; }
  function clearLabels() { G.labels = ['', '', '', '', '']; }

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
      G.auction = null; clearLabels(); render();
      const ender = await playRound(turn);
      const summary = scoreRound();
      G.turn = ender; render();
      if (round < 4) {
        ui.status(G.endMsg || `Round ${round} is over.`);
        G.auction = { artist: summary[0], type: summary[1], seller: summary[2], high: '', cards: null };
        render();
        await ui.ok(`Round ${round + 1}`);
      } else {
        G.auction = { artist: summary[0], type: summary[1], seller: summary[2], high: '', cards: null };
        endGame();
      }
      turn = ender;
    }
  }

  async function playRound(p) {
    for (;;) {
      if (handOf(p).length === 0) {
        if (!anyCards()) { G.endMsg = 'Nobody has any paintings left. The round is over.'; return prev(p); }
        p = next(p); continue;
      }
      G.turn = p; clearLabels(); render();
      const res = p === HUMAN ? await humanTurn() : await aiTurn(p);
      if (res.ended) return res.ended;
      p = next(res.auctioneer);
    }
  }

  function endRoundWith(p, card, second) {
    G.cards[card] = 9; if (second) G.cards[second] = 9;
    const what = typeOf(card) === 1 ? (second ? 'double ' : 'a lone double ') : 'a ';
    G.endMsg = `${NAMES[p]} ends the round with ${what}${ARTISTS[artist(card)]}${second ? 's' : ''}.`;
    return { ended: p };
  }

  async function aiTurn(p) {
    ui.status(`${NAMES[p]} is choosing a painting…`);
    const pick = AI.pickACard(p);
    let { card, second } = pick;
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
      ui.status('Click a painting to auction (click it again to confirm).');
      const card = await ui.card({ kind: 'play' });
      const a = artist(card), out = AI.countOut();
      if (out[a] === 4) {
        if (!(await ui.confirm('Are you sure you want to end the round?'))) continue;
        return endRoundWith(HUMAN, card, 0);
      }
      if (typeOf(card) === 3 && lowFixedWarning(card, false) &&
          !(await ui.confirm('The maximum you can charge for this painting is low. Continue?'))) continue;
      if (typeOf(card) !== 1) return auction(HUMAN, card, 0);

      // a double: choose a second painting, play it alone, or cancel
      setAuctionPanel(HUMAN, [card], 'Double', 'High:'); render();
      for (;;) {
        ui.status(`Select a second ${ARTISTS[a]}, or choose No Second Card.`);
        const s = await ui.card({ kind: 'second', artist: a, exclude: card, canCancel: true });
        if (s === 'cancel') break;
        if (s === 'none') {
          if (!(await ui.confirm('Are you sure you want to give up your turn?'))) continue;
          return loneDouble(HUMAN, card);
        }
        if (out[a] === 3) {
          if (!(await ui.confirm('Are you sure you want to end the round?'))) continue;
          return endRoundWith(HUMAN, card, s);
        }
        if (typeOf(s) === 3 && lowFixedWarning(s, true) &&
            !(await ui.confirm('The maximum you can charge for these paintings is low. Continue?'))) continue;
        return auction(HUMAN, card, s);
      }
    }
  }

  // A double was played without a second painting: each other player, in turn
  // order, may add one and run the auction themselves (German rules: the person
  // adding the second card receives the whole price).
  async function loneDouble(seller, card) {
    const a = artist(card), out = AI.countOut();
    setAuctionPanel(seller, [card], 'Lone Double', 'High:');
    let msg = `${NAMES[seller]} plays a lone double ${ARTISTS[a]}. `;
    ui.status(msg); render();
    for (let y = next(seller); y !== seller; y = next(y)) {
      let second = 0;
      if (y === HUMAN) {
        for (;;) {
          ui.status(msg + `Add a second ${ARTISTS[a]} to auction both yourself, or choose No Second Card.`);
          const s = await ui.card({ kind: 'second', artist: a });
          if (s === 'none') break;
          if (out[a] === 3 && !(await ui.confirm('Are you sure you want to end the round?'))) continue;
          if (out[a] !== 3 && typeOf(s) === 3 && lowFixedWarning(s, true) &&
              !(await ui.confirm('The maximum you can charge for these paintings is low. Continue?'))) continue;
          second = s; break;
        }
      } else {
        second = AI.chooseSecond(y, card);
        if (second) msg += `${NAMES[y]} completes it. `;
      }
      if (second) {
        G.turn = y;
        if (out[a] === 3) {
          const r = endRoundWith(y, card, second);
          G.endMsg = msg + 'This ends the round.';
          return r;
        }
        return auction(y, card, second, msg);
      }
    }
    G.cards[card] = seller + 4;
    G.hist[G.round][seller] += `Received lone double ${ARTISTS[a]} for free.\n`;
    setHigh('High: Free');
    ui.status(`${NAMES[seller]} receives the lone double ${ARTISTS[a]} for free.`);
    render();
    await ui.ok();
    return { auctioneer: seller };
  }

  // Run an auction. Returns {auctioneer}.
  async function auction(seller, card, second, prefix = '') {
    const a = artist(card), P = AI.auctionParams(card, second);
    const cards = second ? [card, second] : [card];
    G.turn = seller;
    // AI valuations are computed with the paintings still in hand, as in the original.
    const bids = AI.aiBids(card, second, seller);
    G.cards[card] = 11; if (second) G.cards[second] = 11;
    setAuctionPanel(seller, cards, AUC[P.aucType] + ' Auction', 'High: <?>');
    clearLabels(); render();
    const tag = (second ? 'Double ' : '') + ARTISTS[a];
    const humanMax = Math.min(P.cap, G.money[4]);
    const prevValue = P.maxPrice - 30;
    const defBid = Math.min(humanMax, P.dbl ? 2 * prevValue : prevValue);
    const hint = { card, second, seller };
    let buyer = seller, price = 0, extra = '';

    switch (P.aucType) {
      case 2: { // hidden
        ui.status(prefix + 'Hidden auction: enter your secret bid.');
        const b = await ui.bid({ min: 0, max: humanMax, def: defBid, hint });
        bids[4] = b || 0;
        let best = 0; buyer = 0;
        for (let k = 0, g = seller; k < 4; k++, g = next(g)) if (bids[g] > best) { best = bids[g]; buyer = g; }
        if (!buyer) buyer = seller;
        price = best;
        for (let p = 1; p <= 4; p++) setLabel(p, `<${bids[p]}>`);
        if (buyer === HUMAN) {
          let nh = 0;
          for (let x = 1; x <= 3; x++) if (bids[x] > bids[nh]) nh = x;
          if (nh) extra = `  (${NAMES[nh]}: ${bids[nh]})`;
        }
        break;
      }
      case 3: { // fixed price
        let fp;
        if (seller === HUMAN) {
          ui.status(prefix + 'Fixed price: set your price.');
          setHigh('High: <?>');
          fp = await ui.bid({ min: 1, max: G.money[4], def: Math.max(1, defBid), bidLabel: 'Set Price', canPass: false, hint });
          buyer = 0;
          for (let x = 1; x <= 3 && !buyer; x++) if (bids[x] >= fp) buyer = x;
          if (!buyer) { buyer = HUMAN; extra = '  (No one would buy it; you were forced to.)'; }
        } else {
          fp = AI.aiFixedPrice(seller, card, second);
          setHigh(`Price: ${fp}`);
          buyer = 0;
          for (let x = next(seller); x !== seller && !buyer; x = next(x)) {
            if (x === HUMAN) {
              const can = fp <= G.money[4];
              ui.status(prefix + `${NAMES[seller]} offers ${tag} for ${fp}. ` + (can ? 'Buy it?' : 'You cannot afford it.'));
              const r = await ui.bid({ min: can ? fp : 1, max: can ? fp : 0, def: fp, bidLabel: 'Buy', fixed: true, hint });
              if (r !== null) buyer = HUMAN; else setLabel(HUMAN, '<Pass>');
            } else if (bids[x] >= fp) buyer = x;
          }
          if (!buyer) { buyer = seller; extra = `  (No one bought it; ${NAMES[seller]} was forced to.)`; }
        }
        price = fp;
        setLabel(buyer, `<${fp}>`);
        break;
      }
      case 4: { // once around: each player once, starting left of the auctioneer
        let high = 0, hp = 0;
        for (let x = next(seller), k = 0; k < 4; k++, x = next(x)) {
          if (x === HUMAN) {
            setHigh(hp ? `High: ${NAMES[hp]} <${high}>` : 'High: None <0>');
            ui.status(prefix + 'Once around: raise the high bid or pass.');
            const b = await ui.bid({ min: high + 1, max: humanMax, def: high + 1, hint });
            if (b !== null && b > high) { high = b; hp = HUMAN; setLabel(HUMAN, `<${b}>`); }
            else setLabel(HUMAN, '<Pass>');
          } else if (bids[x] > high) {
            // the player just before the auctioneer, and the auctioneer, only raise by 1
            high = (x === seller || next(x) === seller) ? high + 1 : bids[x];
            hp = x; setLabel(x, `<${high}>`);
          } else setLabel(x, '<Pass>');
          render();
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
        if (tops.length > 1) {
          cm = tops[Math.floor(tops.length * G.rng())];
          final = bids[cm];
        } else {
          cm = tops[0];
          final = bids[sm] + 1;
          if (final === bids[cm] - 1) final = bids[cm];
        }
        if (final === 0) cm = seller;
        for (let x = 1; x <= 3; x++) {
          const shown = x === cm ? final : (bids[x] >= final && final !== 0 ? final - 1 : bids[x]);
          setLabel(x, `<${shown}>`);
        }
        let curMin = final + 1;
        ui.status(prefix + 'Open auction: outbid ' + (final ? NAMES[cm] : 'everyone') + ' or pass.');
        for (;;) {
          setHigh(final === 0 ? 'High: None' : `High: ${NAMES[cm]} <${curMin - 1}>`);
          const b = await ui.bid({ min: curMin, max: humanMax, def: curMin, hint });
          const bv = b || 0;
          if (bids[cm] <= bv) { buyer = bv === 0 ? seller : HUMAN; price = bv; break; }
          if (bv === 0) { buyer = cm; price = curMin - 1; setLabel(HUMAN, '<Pass>'); break; }
          setLabel(HUMAN, `<${bv}>`);
          curMin = bv + 2;
          if (curMin === bids[cm]) curMin = bids[cm] + 1;
          setLabel(cm, `<${curMin - 1}>`);
          ui.status(`${NAMES[cm]} has outbid you. Continue?`);
        }
        if (buyer === HUMAN) setLabel(HUMAN, `<${price}>`);
        break;
      }
    }

    // settle
    G.money[buyer] -= price;
    if (buyer !== seller) G.money[seller] += price;
    G.cards[card] = buyer + 4; if (second) G.cards[second] = buyer + 4;
    record(buyer, seller, price, tag);
    setHigh(price === 0 && buyer === seller ? 'High: None (free)' : `High: ${NAMES[buyer]} <${price}>`);
    ui.status(`${prefix}${NAMES[buyer]} ${buyer === HUMAN ? 'purchase' : 'purchases'} ${tag} for ${price}.${extra}`.replace('Doris purchase ', 'You purchase '));
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
    const award = [30, 20, 10];
    const lines = [];
    for (let k = 0; k < 3; k++) {
      const a = order[k];
      if (numout[a] >= 1) { G.tv[R][a] = award[k]; lines.push(`${award[k]}: ${ARTISTS[a]}`); }
      else lines.push('');
    }
    const total = a => { let s = 0; for (let r = 1; r <= R; r++) s += G.tv[r][a]; return s; };
    for (let c = 1; c <= 70; c++) {
      if (C[c] > 4 && C[c] < 9 && G.tv[R][artist(c)] !== 0) {
        const p = C[c] - 4, v = total(artist(c));
        G.money[p] += v;
        record(0, p, v, ARTISTS[artist(c)]);
      }
    }
    for (let p = 1; p <= 4; p++) G.hist[R][p] += `Round ${R} total: ${G.money[p]}\n`;
    G.scored = true;
    return lines;
  }

  function historyText() {
    let t = `Modern Art\nGame ${pad7(G.num)}\n\n----------------------\n`;
    for (let r = 1; r <= G.round; r++) {
      t += `Round ${r}\n----------------------\n`;
      for (let p = 1; p <= 4; p++) t += `${NAMES[p]}:\n${G.hist[r][p] || '(nothing yet)\n'}\n`;
      if (r < G.round) t += '----------------------\n';
    }
    if (G.over) t += `*** ${G.result} ***\n`;
    return t;
  }

  function endGame() {
    G.over = true; G.turn = 0; clearLabels();
    const best = Math.max(...G.money.slice(1));
    const winners = [1, 2, 3, 4].filter(p => G.money[p] === best);
    G.result = winners.map(p => `${NAMES[p]} wins!`).join('  ');
    ui.status(G.result);
    render();
    const rows = [1, 2, 3, 4].sort((x, y) => G.money[y] - G.money[x])
      .map(p => `<li>${NAMES[p]}${p === HUMAN ? ' (you)' : ''}: <b>${G.money[p]}</b></li>`).join('');
    openModal('Game over', `<p><b>${G.result}</b></p><ol>${rows}</ol><h3>History</h3><pre>${esc(historyText())}</pre>`,
      [['New Game', () => startGame()], ['Close', null]]);
  }

  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // =========================================================================
  // Menus, hints, controls
  // =========================================================================
  function startGame(num) {
    ui.reset();
    token++;
    if (num === undefined) num = Math.floor(10000000 * Math.random());
    G = freshState(num);
    AI.bind(G);
    hintCards = [];
    document.title = `Modern Art - Game ${pad7(num)}`;
    $('#gameTitle').textContent = `Game ${pad7(num)}`;
    runGame().catch(e => { if (!(e instanceof Abort)) { console.error(e); ui.status('Error: ' + e.message); } });
  }

  function hintCard() {
    if (!G || !handMode || handMode.kind !== 'play') return;
    const rng = G.rng; G.rng = Math.random; // keep the game's random sequence untouched
    const pick = AI.pickACard(HUMAN);
    G.rng = rng;
    if (!pick) return;
    hintCards = [pick.card, pick.second];
    let t = `Suggested: ${cardName(pick.card)}`;
    if (typeOf(pick.card) === 1) t += pick.second ? ` with ${cardName(pick.second)} (yellow)` : ' as a lone double';
    ui.status(t);
    renderHand();
  }

  function hintBid() {
    if (!bidHintCtx) return;
    const { card, second, seller } = bidHintCtx;
    ui.status('Recommended maximum bid: ' + AI.bidHint(card, second, seller));
  }

  const RULES = `
<h3>Goal</h3><p>Have the most money after four rounds. Everyone starts with 100.</p>
<h3>Your turn</h3><p>Put one painting from your hand up for auction. Others bid; the winner pays you. If you buy your own painting, you pay the bank.</p>
<h3>Auction types</h3><ul>
<li><b>Hidden</b> (●): everyone secretly bids once. Highest wins. The auctioneer wins ties, then the player nearest the auctioneer's left.</li>
<li><b>Fixed price</b> ($): the auctioneer sets a price (no more than their own money). Going left, each player may buy. If nobody does, the auctioneer must buy it.</li>
<li><b>Once around</b> (↻): starting left of the auctioneer, each player gets one chance to raise or pass; the auctioneer goes last.</li>
<li><b>Open</b> (✥): free bidding until nobody will raise.</li>
<li><b>Double</b> (=): play a second painting by the same artist (not another double) and sell both together, using the second card's auction type. If you don't, the next players in order may add one. Whoever does runs the auction and keeps all the money, and play continues from them. If nobody does, you get the double for free.</li></ul>
<p>If no one bids in an auction, the auctioneer gets the painting free.</p>
<h3>End of a round</h3><p>A round ends when the 5th painting by one artist is played. That painting isn't sold, but it counts. The three artists with the most paintings this round are worth 30, 20 and 10, and ties go to the artist further left on the board. Each painting you bought this round sells to the bank for that artist's value <i>added up over all rounds</i>, but only if the artist placed this round. Hands get 9 cards in round 1, 4 more in rounds 2 and 3, and none in round 4.</p>
<h3>Controls</h3><p>Click a painting to select it and click it again (or double-click) to auction it. Use ▲▼ for ±1 and ⏶⏷ for ±10. The <b>Training</b> menu proposes a painting or a bid.</p>`;

  function initControls() {
    buildBoard();
    // menus
    document.querySelectorAll('.menu-title').forEach(t => t.addEventListener('click', e => {
      const m = t.parentElement, open = m.classList.contains('open');
      document.querySelectorAll('.menu').forEach(x => x.classList.remove('open'));
      if (!open) m.classList.add('open');
      e.stopPropagation();
    }));
    document.addEventListener('click', () => document.querySelectorAll('.menu').forEach(x => x.classList.remove('open')));
    document.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.menu').forEach(x => x.classList.remove('open'));
      const cmd = b.dataset.cmd;
      if (cmd === 'new') startGame();
      if (cmd === 'specific') askSpecific();
      if (cmd === 'history') openModal('Game History', G ? `<pre>${esc(historyText())}</pre>` : '<p>No game in progress.</p>', [['Close', null]]);
      if (cmd === 'hintCard') hintCard();
      if (cmd === 'hintBid') hintBid();
      if (cmd === 'rules') openModal('How to play Modern Art', RULES, [['Close', null]]);
      if (cmd === 'modern') location.href = '../';
      if (cmd === 'about') openModal('About', `<p><b>Modern Art</b> — High Stakes Bidding in the Galleries</p>
        <p>Game designed by Reiner Knizia. Originally programmed in Visual Basic 6 by Gabriel Rocklin (v1.1.9, 2005–06); ported to the web.</p>
        <p>The bidding AI is a 95×40×1 neural network (one per round), trained with backpropagation and then tuned by playing itself. The card-play AI scores each painting against five goals, using coefficients evolved with a genetic algorithm.</p>
        <p>Doubles use the original German rule: whoever adds the second painting collects the whole price.</p>
        <h3>Credits</h3>
        <p><b>Modern Art</b> is a board game designed by Reiner Knizia (© Reiner Knizia). The artist paintings and card art come from the published game; all rights belong to Reiner Knizia and the game's publishers.</p>
        <p>This is an <b>unofficial, non-commercial fan project</b> and is not affiliated with or endorsed by the designer or publishers. If you enjoy it, please <a href="https://boardgamegeek.com/boardgame/118/modern-art" target="_blank" rel="noopener">buy the real game</a>.</p>
        <p>Rights holders: to request changes or removal, please <a href="https://github.com/grocklin/modern-art/issues" target="_blank" rel="noopener">open an issue on GitHub</a>.</p>`, [['OK', null]]);
    }));
    // bid steppers and box
    document.querySelectorAll('.steppers button').forEach(b => b.addEventListener('click', () => {
      const box = $('#bidBox'), step = +b.dataset.step;
      let v = (parseInt(box.value, 10) || 0) + step;
      v = Math.max(bidLimits.min, Math.min(bidLimits.max, v));
      box.value = String(v);
    }));
    const box = $('#bidBox');
    box.addEventListener('input', () => { box.value = box.value.replace(/\D/g, ''); });
    box.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        let v = (parseInt(box.value, 10) || 0) + (e.key === 'ArrowUp' ? 1 : -1);
        box.value = String(Math.max(bidLimits.min, Math.min(bidLimits.max, v)));
      }
      if (e.key === 'Enter' && !$('#btnBid').disabled) $('#btnBid').click();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('#modal').hidden && $('#modalButtons').children.length === 1) closeModal();
    });
    ui.idle();
    renderAuction();
  }

  function askSpecific() {
    const cur = G ? pad7(G.num) : '';
    openModal('New Specific Game', `<p>Enter game number:</p><input id="gnum" inputmode="numeric" maxlength="7" value="${cur}">`, [
      ['OK', () => { const v = parseInt(($('#gnum') || {}).value, 10); if (!isNaN(v) && v >= 0) startGame(v % 10000000); }],
      ['Cancel', null],
    ]);
    const inp = $('#gnum');
    inp.focus(); inp.select();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') $('#modalButtons button').click(); });
  }

  window.MA_DEBUG = () => G; // for console inspection
  initControls();
  startGame();
})();
