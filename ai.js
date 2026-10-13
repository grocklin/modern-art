// Modern Art AI — a faithful port of the VB6 AI routines from board.frm (v1.1.9).
//
// The card-play coefficients and the bidding nets were evolved/trained against
// this exact logic, so the quirks are preserved deliberately (each is marked
// "VB quirk").  Arrays are 1-indexed like the original to keep the port auditable.
//
// Card location codes (G.cards[c]) are the same as the VB `cards(c, 1)`:
//   0 = deck, 1-4 = in player's hand, 5-8 = bought this round by player (code-4),
//   9 = card that ended the round, 10 = sold back / previous rounds, 11 = being auctioned.

(function () {
  'use strict';
  const GL = 95, SL = 40, TN = GL + SL + 1;
  const SIGMOIDAL = 2, OWN_BID = 0.55, NP = 5;
  const W = window.MA_WEIGHTS;

  // ---- card helpers -------------------------------------------------------
  const AUCS = [null, '112233444555', '1122233344555', '11222333444555', '111222333444555', '1112223334445555'];
  const OFFS = [0, 0, 12, 25, 39, 54];
  function artist(c) { return c <= 12 ? 1 : c <= 25 ? 2 : c <= 39 ? 3 : c <= 54 ? 4 : 5; }
  function typeOf(c) { const a = artist(c); return +AUCS[a][c - OFFS[a] - 1]; }

  // VB assigns floating values to Integer with banker's rounding.
  function cint(v) {
    const f = Math.floor(v), d = v - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }
  const f32 = Math.fround; // VB `Single`
  const pop = i => W.POPULATION[i - 1];   // ThePopulation(1, i)
  const decay = i => W.DECAY[i - 1];      // TheDecay(1, i)
  const net = (r, i) => W.NETS[r - 1][i - 1]; // neuralnet(r, i)

  // Module-level state shared between routines, exactly as in VB.
  // (Stale `neurons` values are read by SetUpHand in a few places — VB quirk.)
  const neurons = new Array(TN + 1).fill(0);
  const hand = [];
  const weightsUsed = []; // weightsUsed[x][goal]: weight applied to each goal rating (for hint explanations only)
  for (let i = 0; i <= 17; i++) hand.push(new Array(NP + 3).fill(0));

  let G = null; // game state: {cards[71], money[5], round, tv[5][6], rng()}
  function bind(game) { G = game; }

  function sumValues(a) { let s = 0; for (let r = 1; r <= 4; r++) s += G.tv[r][a]; return s; }

  // ---- neural net ----------------------------------------------------------
  function activeFunction(v) { return 2 * (1 / (1 + Math.pow(2.71828183, -(v / SIGMOIDAL)))) - 1; }
  function whichCnxn(from, to) {
    if (from === 0) return to === TN ? (GL + 2) * SL + 1 : GL * SL + to - GL;
    return to === TN ? (GL + 1) * SL + from - GL : GL * (to - GL - 1) + from;
  }

  function calcNeurons(player, auction, zartist, dualauc, auctioneer, calcGround) {
    for (let x = GL + 1; x <= TN; x++) neurons[x] = 0;
    if (calcGround) {
      for (let x = 1; x <= GL; x++) neurons[x] = 0;
      calcGroundMethodThree(player, auction, zartist, dualauc, auctioneer);
    }
    const r = G.round;
    for (let x = 1; x <= SL; x++) {
      let s = 0;
      for (let y = 1; y <= GL; y++) s = f32(s + net(r, GL * (x - 1) + y) * neurons[y]);
      s = f32(s + net(r, whichCnxn(0, x + GL)) * -1);
      if (Math.abs(s) > 500) s = 500 * Math.sign(s);
      neurons[x + GL] = f32(activeFunction(s));
    }
    let o = 0;
    for (let x = 1; x <= SL; x++) o = f32(o + net(r, whichCnxn(GL + x, TN)) * neurons[GL + x]);
    o = f32(o + net(r, whichCnxn(0, TN)) * -1);
    if (Math.abs(o) > 500) o = 500 * Math.sign(o);
    neurons[TN] = f32(1 / (1 + Math.pow(2.71828183, -(o / SIGMOIDAL))));
  }

  function calcGroundMethodThree(player, auction, zartist, dualauc, auctioneer) {
    const C = G.cards;
    const numout = [0, 0, 0, 0, 0, 0];
    const leader = [0, 0, 0, 0, 0, 5];
    for (let x = 1; x <= 5; x++) numout[x] = f32(0.6 - x / 10);
    for (let x = 1; x <= 70; x++) if (C[x] >= 5 && C[x] <= 8) numout[artist(x)] = f32(numout[artist(x)] + 1);
    numout[zartist] = f32(numout[zartist] + 1);
    if (dualauc) numout[zartist] = f32(numout[zartist] + 1);
    for (let x = 1; x <= 5; x++) {
      if (numout[x] > numout[leader[1]]) { leader[5] = leader[4]; leader[4] = leader[3]; leader[3] = leader[2]; leader[2] = leader[1]; leader[1] = x; }
      if (numout[x] > numout[leader[2]] && x !== leader[1]) { leader[5] = leader[4]; leader[4] = leader[3]; leader[3] = leader[2]; leader[2] = x; }
      if (numout[x] > numout[leader[3]] && x !== leader[2] && x !== leader[1]) { leader[5] = leader[4]; leader[4] = leader[3]; leader[3] = x; }
      if (numout[x] > numout[leader[4]] && x !== leader[3] && x !== leader[2] && x !== leader[1]) { leader[5] = leader[4]; leader[4] = x; }
      if (numout[x] > numout[leader[5]] && x !== leader[4] && x !== leader[3] && x !== leader[2] && x !== leader[1]) leader[5] = x;
    }
    const back = [0, 0, 0, 0, 0, 0];
    for (let x = 1; x <= 5; x++) back[leader[x]] = x;
    for (let x = 1; x <= 5; x++) {
      numout[x] = f32(numout[x] - f32(0.6 - x / 10));
      numout[x] = (numout[x] - Math.floor(numout[x]) < 0.05) ? Math.floor(numout[x]) : Math.floor(numout[x]) + 1;
    }
    let ws;
    for (let x = 1; x <= 70; x++) {
      const a = artist(x), c = C[x];
      if (a !== zartist) {
        if (c >= 5 && c <= 8) {
          if (c - 4 !== player) {
            ws = c - 4 - auctioneer; if (ws < 0) ws += 4;
            if (auctioneer === 0) ws = c - 5;
            neurons[a + 5 * ws] += 1;
          } else {
            neurons[20 + a] += 1;
            neurons[69 + back[a]] += 1;
          }
        }
        if (c === player) {
          if (typeOf(x) !== 1) { neurons[25 + a] += 1; neurons[74 + back[a]] += 1; }
          else neurons[30 + a] += 1;
        }
      } else {
        if (c >= 5 && c <= 8) {
          if (c - 4 !== player) {
            ws = c - 4 - auctioneer; if (ws < 0) ws += 4;
            if (auctioneer === 0) ws = c - 5;
            neurons[36 + ws] += 1;
          } else neurons[40] += 1;
        }
        if (c === player) {
          if (typeOf(x) !== 1) neurons[41] += 1;
          if (typeOf(x) === 1) neurons[42] += 1;
        }
      }
    }
    neurons[80] = neurons[41];
    if (neurons[42] < neurons[41]) neurons[80] = neurons[42];
    for (let x = 1; x <= 5; x++) {
      neurons[80 + x] = neurons[25 + x];
      if (neurons[30 + x] < neurons[25 + x]) neurons[80 + x] = neurons[30 + x];
    }
    for (let x = 1; x <= 42; x++) if (neurons[x] === 0) neurons[x] = -1;
    for (let x = 69; x <= 85; x++) if (neurons[x] === 0) neurons[x] = -1;
    neurons[74 + back[zartist]] = 0;
    for (let x = 0; x <= 30; x += 5) neurons[zartist + x] = 0;
    neurons[43] = dualauc ? 1 : -1;
    for (let x = 1; x <= 5; x++) neurons[43 + x] = -1;
    neurons[43 + zartist] = 1;
    ws = player - auctioneer;
    for (let x = 1; x <= 4; x++) neurons[48 + x] = -1;
    if (ws < 0) ws += 4;
    neurons[49 + ws] = 1; // VB quirk: with auctioneer 0 this can hit neuron 53
    const tv0 = [0, 0, 0, 0, 0, 0];
    for (let x = 1; x <= 5; x++) tv0[x] = sumValues(x);
    for (let x = 1; x <= 5; x++) neurons[52 + x] = f32(neurons[52 + x] + (tv0[x] - tv0[zartist]) / 30);
    neurons[58] = f32(tv0[zartist] / 30);
    for (let x = 0; x <= 4; x++) {
      neurons[59 + x] = numout[zartist] - numout[leader[1 + x]];
      if (leader[1 + x] < zartist) neurons[59 + x] -= 0.5;
      if (leader[1 + x] > zartist) neurons[59 + x] += 0.5;
    }
    for (let k = 1; k <= 5; k++) if (leader[k] !== zartist) neurons[63 + k] = numout[leader[k]];
    for (let x = 1; x <= 5; x++) if (neurons[63 + x] === 0) neurons[63 + x] = -1;
    neurons[63 + back[zartist]] = 0;
    neurons[69] = numout[zartist] - 1;
    if (neurons[69] === 0) neurons[69] = -1;
    for (let x = 1; x <= 5; x++) neurons[85 + x] = neurons[58 + back[x]];
    for (let x = 1; x <= 5; x++) {
      neurons[90 + x] = -1;
      if (x !== 5 && neurons[58 + x] === 0 && neurons[58 + x + 1] > 0) neurons[90 + x] = 1;
      if (x === 5 && neurons[58 + x] === 0) neurons[90 + x] = 1;
    }
  }

  // ---- card evaluation (SetUpHand) ----------------------------------------
  function rankLeaders(nn, count) {
    const L = new Array(count + 1).fill(0);
    for (let y = 1; y <= 5; y++) {
      if (nn[y] > nn[L[1]]) { for (let k = count; k > 1; k--) L[k] = L[k - 1]; L[1] = y; }
      if (nn[y] > nn[L[2]] && y !== L[1]) { for (let k = count; k > 2; k--) L[k] = L[k - 1]; L[2] = y; }
      if (nn[y] > nn[L[3]] && y !== L[2] && y !== L[1]) { for (let k = count; k > 3; k--) L[k] = L[k - 1]; L[3] = y; }
      if (count >= 4 && nn[y] > nn[L[4]] && y !== L[3] && y !== L[2] && y !== L[1]) L[4] = y;
    }
    return L;
  }

  // "What if this artist gets `add` more cards" — shared by the numout==3/4 blocks.
  function projectedShift(x, numout, IHave, add) {
    const nn = [0, 0, 0, 0, 0, 0];
    for (let y = 1; y <= 5; y++) nn[y] = f32(0.6 - y / 10) + numout[y];
    nn[artist(hand[x][1])] += add;
    const NL = rankLeaders(nn, 4);
    if (nn[NL[2]] - nn[NL[3]] <= 1) hand[x][2] += 10 * (IHave[NL[2]] - IHave[NL[3]]);
    if (nn[NL[3]] - nn[NL[4]] <= 1) hand[x][2] += 10 * (IHave[NL[3]] - IHave[NL[4]]);
  }

  function coef(round, whichDecay, y) {
    return pop(NP * (round - 1) + y) + decay(NP * whichDecay + y);
  }

  // Returns the number of cards evaluated; results in `hand[1..n][1..7]`
  // (hand[x][1] = card id, hand[x][7] = desirability score).
  function setUpHand(who, isAlreadyDouble) {
    const C = G.cards, R = G.round;
    const IHave = [0, 0, 0, 0, 0, 0];
    const numout = [0, 0, 0, 0, 0, 0];
    for (let x = 1; x <= 5; x++) numout[x] = f32(0.6 - x / 10);
    for (let x = 1; x <= 17; x++) for (let y = 1; y <= NP + 2; y++) hand[x][y] = 0;
    for (let x = 1; x <= 70; x++) {
      if (C[x] >= 5 && C[x] <= 8) numout[artist(x)] = f32(numout[artist(x)] + 1);
      if (C[x] === who + 4) IHave[artist(x)]++;
    }
    const leader = rankLeaders(numout, 3);
    for (let x = 1; x <= 5; x++) numout[x] = Math.floor(numout[x]);
    const AddValue = [0, 0, 0, 0, 0, 0];
    for (let y = 1; y <= 5; y++) AddValue[y] = sumValues(y) + 10;

    let n = 0, maxPrice, tempBiddo, dubz;
    const L1 = leader[1], L2 = leader[2], L3 = leader[3];
    const whichDecayOf = () => {
      let wd = 0;
      if (numout[L1] >= 2 && numout[L2] >= 1) wd = 1;
      if (numout[L1] >= 3 && numout[L2] >= 2) wd = 2;
      if (numout[L1] >= 4 && numout[L2] >= 3) wd = 3;
      return wd;
    };
    const typeBonus = (x) => {
      switch (typeOf(hand[x][1])) {
        case 2: if (hand[x][4] !== 0) hand[x][4] += 0.1; break;
        case 3:
          if (neurons[TN] >= 0.24) { // VB quirk: may be a stale value
            if (hand[x][5] !== 0) hand[x][5] += 0.05;
            if (hand[x][6] !== 0) hand[x][6] += 0.05;
          }
          break;
        case 5: // VB quirk: `Case 4 Or 5` evaluates to `Case 5`
          if (hand[x][4] !== 0) hand[x][4] += 0.03;
          if (hand[x][5] !== 0) hand[x][5] += 0.03;
          if (hand[x][6] !== 0) hand[x][6] += 0.03;
          break;
      }
    };

    if (isAlreadyDouble === 0) {
      for (let x = 1; x <= 70; x++) if (C[x] === who) hand[++n][1] = x;
      const DIA = [];
      for (let x = 0; x <= 5; x++) DIA.push([0, 0, 0, 0]);
      for (let x = 1; x <= n; x++) {
        const a = artist(hand[x][1]);
        if (typeOf(hand[x][1]) === 1) DIA[a][1]++; else { DIA[a][2]++; DIA[a][3]++; }
      }
      for (let x = 1; x <= 5; x++) if (DIA[x][1] < DIA[x][2]) DIA[x][2] = DIA[x][1];
      for (let x = 1; x <= 5; x++) { DIA[0][1] += DIA[x][1]; DIA[0][2] += DIA[x][2]; }

      for (let x = 1; x <= n; x++) {
        const card = hand[x][1], a = artist(card), isDbl = typeOf(card) === 1;
        if (isDbl) {
          // nothing to 3
          if (a !== L3 && a !== L2 && a !== L1) {
            if (numout[a] === numout[L3]) hand[x][2] = AddValue[a] * IHave[a];
            if (numout[a] === numout[L3] - 1) hand[x][2] = AddValue[a] * IHave[a];
            if (numout[a] === numout[L3] - 2) hand[x][3] = (AddValue[a] / 2) * IHave[a];
            hand[x][2] -= AddValue[L3] * IHave[L3];
          }
          // 3 to 2
          if (a !== L2 && a !== L1) {
            if (numout[a] === numout[L2] || numout[a] === numout[L2] - 1) {
              hand[x][2] += 10 * IHave[a]; hand[x][2] -= 10 * IHave[L2];
              if (IHave[L2] === IHave[a] && IHave[L2] > 0) hand[x][2] += 5;
            }
            if (numout[a] === numout[L2] - 2) {
              hand[x][3] = hand[x][2] + 5 * IHave[a]; // VB quirk: reads hand(x,2)
              hand[x][3] -= 5 * IHave[L2];
              if (IHave[L2] === IHave[a] && IHave[L2] > 0) hand[x][3] += 5;
            }
          }
          // 2 to 1
          if (a !== L1) {
            if (numout[a] === numout[L1] || numout[a] === numout[L1] - 1) {
              hand[x][2] += 10 * IHave[a]; hand[x][2] -= 10 * IHave[L1];
              if (IHave[L1] === IHave[a] && IHave[L1] > 0) hand[x][2] += 5;
            }
            if (numout[a] === numout[L1] - 2) {
              hand[x][3] = hand[x][2] + 5 * IHave[a]; // VB quirk
              hand[x][3] -= 5 * IHave[L1];
              if (IHave[L1] === IHave[a] && IHave[L1] > 0) hand[x][3] += 5;
            }
          }
          // 1 steady
          if (a === L1) hand[x][3] += 5 * IHave[a];
          if (a === L2 && numout[L1] - numout[L2] >= 3) hand[x][3] += 5 * IHave[L2];
          if (a === L3 && numout[L2] - numout[L3] >= 3) hand[x][3] += 5 * IHave[L3];
          if (numout[a] === 3) projectedShift(x, numout, IHave, 2);
        } else {
          if (a !== L3 && a !== L2 && a !== L1) {
            if (numout[a] === numout[L3]) hand[x][2] = AddValue[a] * IHave[a];
            if (numout[a] === numout[L3] - 1) hand[x][3] = (AddValue[a] / 2) * IHave[a];
            hand[x][2] -= AddValue[L3] * IHave[L3];
          }
          if (a !== L2 && a !== L1) {
            if (numout[a] === numout[L2]) {
              hand[x][2] += 10 * IHave[a]; hand[x][2] -= 10 * IHave[L2];
              if (IHave[L2] === IHave[a] && IHave[L2] > 0) hand[x][2] += 5;
            }
            if (a === L3 && numout[a] === numout[L2] - 1) {
              hand[x][3] = 5 * IHave[a]; hand[x][3] -= 5 * IHave[L2];
              if (IHave[L2] === IHave[a] && IHave[L2] > 0) hand[x][3] += 5;
            }
          }
          if (a !== L1) {
            if (numout[a] === numout[L1]) {
              hand[x][2] += 10 * IHave[a]; hand[x][2] -= 10 * IHave[L1];
              if (IHave[L1] === IHave[a] && IHave[L1] > 0) hand[x][2] += 5;
            }
            if (numout[a] === numout[L1] - 1) {
              hand[x][3] = 5 * IHave[a]; hand[x][3] -= 5 * IHave[L1];
              if (IHave[L1] === IHave[a] && IHave[L1] > 0) hand[x][3] += 5;
            }
          }
          if (a === L1) hand[x][3] += 5 * IHave[a];
          if (a === L2 && numout[L1] - numout[L2] >= 2) hand[x][3] += 5 * IHave[L2];
          if (a === L3 && numout[L2] - numout[L3] >= 2) hand[x][3] += 5 * IHave[L3];
          if (numout[a] === 4) projectedShift(x, numout, IHave, 1);
        }

        maxPrice = AddValue[a] + 20;
        dubz = false;
        if (isDbl) { maxPrice *= 2; dubz = true; }
        if ((numout[a] <= 3 && !isDbl) || numout[a] <= 2) {
          calcNeurons(who, typeOf(card), a, dubz, 0, true);
          const o = neurons[TN];
          if (o <= 0.24) {
            tempBiddo = (maxPrice - 30 + 7.2) * (o / 0.24);
            if (dubz) tempBiddo *= 2;
          } else {
            tempBiddo = dubz ? 2 * (maxPrice - 60) + 60 * o : (maxPrice - 30) + 30 * o;
          }
          hand[x][4] = f32(tempBiddo);
        }

        let artDubs = 0, artOthers = 0;
        for (let y = 1; y <= n; y++) {
          if (artist(hand[y][1]) === a && x !== y) { if (typeOf(hand[y][1]) === 1) artDubs++; else artOthers++; }
        }
        hand[x][5] = artOthers; hand[x][6] = artDubs;
        if (isDbl) {
          if (artOthers >= 1) hand[x][5] -= 1;
          else { if (R === 1 || R === 2) hand[x][6] = -1; hand[x][4] = 0; }
        } else if (R === 3 || R === 4) {
          if (artDubs > 0 && artOthers === 0) hand[x][5] = -1;
        } else if (artDubs > 0 && artOthers === 0) hand[x][6] = 0;
        hand[x][5] *= 5; hand[x][6] *= 5;
        typeBonus(x);

        const wd = whichDecayOf();
        weightsUsed[x] = [0, 0, 0, 0, 0, 0];
        for (let y = 1; y <= NP; y++) {
          if (R <= 3 || y < 4) {
            const k = coef(R, wd, y);
            if (k > 0) { hand[x][NP + 2] = f32(hand[x][NP + 2] + k * hand[x][1 + y]); weightsUsed[x][y] = k; }
          }
        }
        if (isDbl) {
          if ((R === 1 || R === 2) && DIA[a][3] >= DIA[a][1] && DIA[a][2] < 2) hand[x][NP + 2] = 0;
          if (R === 3 && DIA[0][2] < 2) {
            if (DIA[a][1] > DIA[a][3]) {
              const k = coef(R, wd, 3);
              if (k > 0) hand[x][NP + 2] = f32(hand[x][NP + 2] - k * hand[x][4]);
              hand[x][4] = 0;
            } else hand[x][NP + 2] = 0;
          }
        } else if (R <= 3 && DIA[0][2] < 2 && DIA[a][2] === 1 && DIA[a][3] === 1) {
          hand[x][7] = 0;
        }
      }
    } else {
      const da = artist(isAlreadyDouble);
      for (let x = 1; x <= 70; x++) if (C[x] === who && artist(x) === da) hand[++n][1] = x;
      maxPrice = (AddValue[da] + 20) * 2;
      for (let x = 1; x <= n; x++) {
        const card = hand[x][1], a = artist(card);
        if (typeOf(card) !== 1) {
          if (a !== L3 && a !== L2 && a !== L1) {
            if (numout[a] === numout[L3]) hand[x][2] = AddValue[a] * IHave[a];
            if (numout[a] === numout[L3] - 1) hand[x][2] = AddValue[a] * IHave[a];
            if (numout[a] === numout[L3] - 2) hand[x][3] = (AddValue[a] / 2) * IHave[a];
            hand[x][2] -= AddValue[L3] * IHave[L3];
          }
          if (a !== L2 && a !== L1) {
            if (numout[a] === numout[L2] || numout[a] === numout[L2] - 1) {
              hand[x][2] += 10 * IHave[a]; hand[x][2] -= 10 * IHave[L2];
              if (IHave[L2] === IHave[a] && IHave[L2] > 0) hand[x][2] += 5;
            }
            if (numout[a] === numout[L2] - 2) {
              hand[x][3] = 5 * IHave[a]; hand[x][3] -= 5 * IHave[L2];
              if (IHave[L2] === IHave[a] && IHave[L2] > 0) hand[x][3] += 5;
            }
          }
          if (a !== L1) {
            if (numout[a] === numout[L1] || numout[a] === numout[L1] - 1) {
              hand[x][2] += 10 * IHave[a]; hand[x][2] -= 10 * IHave[L1];
              if (IHave[L1] === IHave[a] && IHave[L1] > 0) hand[x][2] += 5;
            }
            if (numout[a] === numout[L1] - 2) {
              hand[x][3] = 5 * IHave[a]; hand[x][3] -= 5 * IHave[L1];
              if (IHave[L1] === IHave[a] && IHave[L1] > 0) hand[x][3] += 5;
            }
          }
          if (a === L1) hand[x][3] += 5 * IHave[a];
          if (a === L2 && numout[L1] - numout[L2] >= 3) hand[x][3] += 5 * IHave[L2];
          if (a === L3 && numout[L2] - numout[L3] >= 3) hand[x][3] += 5 * IHave[L3];
          if (numout[a] === 3) projectedShift(x, numout, IHave, 2);
        }
        if (numout[a] <= 2) {
          calcNeurons(who, typeOf(card), a, true, 0, true);
          const o = neurons[TN];
          tempBiddo = o <= 0.24 ? (maxPrice - 60 + 14.4) * (o / 0.24) : (maxPrice - 60) + 60 * o;
          hand[x][4] = f32(tempBiddo);
        }
        let artDubs = 0, artOthers = 0;
        for (let y = 1; y <= n; y++) {
          if (artist(hand[y][1]) === a && x !== y) {
            if (typeOf(hand[y][1]) === 1) artDubs++; else artOthers++;
            hand[x][5] += 5;
          }
        }
        if (hand[x][5] > 1) hand[x][5] -= 5;
        if (artDubs < artOthers) artOthers = artDubs;
        hand[x][6] = artOthers;
        typeBonus(x);
        const wd = whichDecayOf();
        for (let y = 1; y <= NP; y++) {
          const k = coef(R, wd, y);
          if (k > 0) hand[x][NP + 2] = f32(hand[x][NP + 2] + k * hand[x][1 + y]);
        }
      }
    }
    return n;
  }

  // ---- decisions -----------------------------------------------------------
  function countOut() {
    const n = [0, 0, 0, 0, 0, 0];
    for (let x = 1; x <= 70; x++) if (G.cards[x] >= 5 && G.cards[x] <= 8) n[artist(x)]++;
    return n;
  }

  // PickACard: returns {card, second} (second = 0 for none / lone double).
  function pickACard(who) {
    const numout = countOut();
    const n = setUpHand(who, 0);
    if (n === 0) return null;
    let card = 0, second = 0;
    for (;;) {
      let cm = 1;
      for (let x = 2; x <= n; x++) if (hand[x][7] > hand[cm][7]) cm = x;
      const ties = [];
      for (let x = 1; x <= n; x++) if (hand[x][7] === hand[cm][7]) ties.push(x);
      cm = ties[Math.floor(ties.length * G.rng())];
      card = hand[cm][1];
      second = 0;
      if (typeOf(card) !== 1) break;
      // VB quirk: takes the *last* qualifying partner, not the best one
      for (let x = 1; x <= n; x++) {
        if (artist(hand[x][1]) === artist(card) && typeOf(hand[x][1]) !== 1 && hand[x][7] > 1) second = hand[x][1];
      }
      if (second !== 0) break;
      if (hand[cm][7] === 0 || numout[artist(card)] >= 3) break;
      hand[cm][7] = 0;
    }
    return { card, second };
  }

  // Would AI `who` add a card to a lone double `dbl`?  Returns the card or 0.
  function chooseSecond(who, dbl) {
    let has = false;
    for (let z = 1; z <= 70; z++) if (G.cards[z] === who && artist(z) === artist(dbl) && typeOf(z) !== 1) { has = true; break; }
    if (!has) return 0;
    const n = setUpHand(who, dbl);
    let cm = 0;
    for (let z = 1; z <= n; z++) if (hand[z][7] > hand[cm][7] && typeOf(hand[z][1]) !== 1) cm = z;
    if (cm !== 0 && hand[cm][7] > 0 && typeOf(hand[cm][1]) !== 1) return hand[cm][1];
    return 0;
  }

  function auctionParams(card, second) {
    let maxPrice = 30 + sumValues(artist(card));
    let aucType = typeOf(card), dbl = false, cap = maxPrice;
    if (aucType === 1) { aucType = typeOf(second); dbl = true; cap = 2 * maxPrice; }
    return { maxPrice, aucType, dbl, cap };
  }

  function rawBid(who, card, second, seller) {
    const p = auctionParams(card, second);
    calcNeurons(who, p.aucType, artist(card), p.dbl, seller, true);
    const o = neurons[TN];
    let t;
    if (o <= 0.24) { t = cint(p.maxPrice * o); if (p.dbl) t = cint(t * 2); }
    else t = cint(p.dbl ? 2 * (p.maxPrice - 30) + 60 * o : (p.maxPrice - 30) + 30 * o);
    if (who === seller) t = cint(t * OWN_BID);
    return t;
  }

  // The player after the auctioneer checks whether its own next move would end
  // the round, which would cap what this painting can be worth.
  function nextPlayerCap(testing, card, second, bid) {
    const C = G.cards;
    const outs = [0, 0, 0, 0, 0, 0];
    for (let a = 1; a <= 70; a++) if (C[a] > 4 && C[a] < 9) outs[artist(a)]++;
    outs[artist(card)] += second === 0 ? 1 : 2;
    const saved = [C[card], second ? C[second] : 0];
    C[card] = testing + 4; if (second) C[second] = testing + 4;
    try {
      const n = setUpHand(testing, 0);
      if (n === 0) return bid;
      const dubs = [0, 0, 0, 0, 0, 0];
      for (let a = 1; a <= n; a++) if (typeOf(hand[a][1]) !== 1) dubs[artist(hand[a][1])] = 1;
      let curMax = -10000; // VB Integer: assignments are rounded (VB quirk)
      for (let a = 1; a <= n; a++) {
        if (typeOf(hand[a][1]) === 1) { if (dubs[artist(hand[a][1])] === 1 && hand[a][7] > curMax) curMax = cint(hand[a][7]); }
        else if (hand[a][7] > curMax) curMax = cint(hand[a][7]);
      }
      let chosen = 0;
      for (let a = 1; a <= n; a++) {
        if (hand[a][7] === curMax && artist(hand[a][1]) !== artist(card)) {
          const need = typeOf(hand[a][1]) === 1 ? 3 : 4;
          if (outs[artist(hand[a][1])] >= need) { chosen = artist(hand[a][1]); break; }
        }
      }
      if (!chosen) return bid;
      outs[chosen] = 5;
      for (let a = 1; a <= 5; a++) outs[a] = f32(outs[a] + 0.5 - a / 10);
      const TL = rankLeaders(outs, 3);
      let mv = 0;
      if (TL[1] === artist(card)) mv = 30;
      if (TL[2] === artist(card)) mv = 20;
      if (TL[3] === artist(card)) mv = 10;
      if (mv !== 0) mv += sumValues(artist(card));
      if (bid >= mv) bid = mv - 1;
      if (bid < 0) bid = 0;
      return bid;
    } finally {
      C[card] = saved[0]; if (second) C[second] = saved[1];
    }
  }

  // Maximum each AI is willing to pay (PlayersBid(1..3) in DoTheBid).
  function aiBids(card, second, seller) {
    const bids = [0, 0, 0, 0, 0];
    for (let x = 1; x <= 3; x++) {
      const t = rawBid(x, card, second, seller);
      bids[x] = t < G.money[x] ? t : G.money[x];
    }
    if (seller !== 3) {
      const tp = seller === 4 ? 1 : seller + 1;
      bids[tp] = nextPlayerCap(tp, card, second, bids[tp]);
    }
    return bids;
  }

  // Price an AI auctioneer sets for a fixed-price auction.
  function aiFixedPrice(seller, card, second) {
    const p = auctionParams(card, second);
    calcNeurons(seller, p.aucType, artist(card), p.dbl, 0, true);
    const o = neurons[TN], k = pop(21);
    let fp;
    // VB quirk: operator precedence applies the coefficient to the neural term only.
    if (o <= 0.24) { fp = cint(p.maxPrice * o); if (p.dbl) fp = cint(fp * 2 * k); }
    else fp = cint(p.dbl ? 2 * (p.maxPrice - 30) + 60 * o * k : (p.maxPrice - 30) + 30 * o * k);
    if (fp === 0) fp = 1;
    if (fp > G.money[seller]) fp = G.money[seller];
    return fp;
  }

  // Training menu: recommended maximum bid for the human (menuBidHint).
  function bidHint(card, second, seller) {
    let t = rawBid(4, card, second, seller);
    if (t > G.money[4]) t = G.money[4];
    if (seller === 3) t = nextPlayerCap(4, card, second, t); // original wrote to the wrong variable here
    return t;
  }

  // For the "suggest a painting" hint: how much each of the five goals contributed to
  // the AI's score for `card` (goal 1 owned-art value, 2 owned-art prospects, 3 sale
  // price, 4 other cards of the artist in hand, 5 doubles in hand). Read-only.
  function explainCard(who, card) {
    const n = setUpHand(who, 0);
    for (let x = 1; x <= n; x++) {
      if (hand[x][1] !== card) continue;
      const w = weightsUsed[x] || [0, 0, 0, 0, 0, 0];
      const goals = [1, 2, 3, 4, 5].map(y => ({ goal: y, rating: hand[x][1 + y], contribution: w[y] * hand[x][1 + y] }));
      return { goals, expectedPrice: hand[x][4], score: hand[x][NP + 2] };
    }
    return null;
  }

  window.MA_AI = {
    explainCard,
    artist, typeOf, cint, bind, countOut, pickACard, chooseSecond, aiBids, aiFixedPrice,
    bidHint, auctionParams, OWN_BID,
  };
})();
