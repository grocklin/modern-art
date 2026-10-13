// Vector redraws of the original 49×49 auction-type bitmaps, plus UI icons.
// All use currentColor so they theme with CSS.
(function () {
  'use strict';
  const svg = (body, vb = 48) =>
    `<svg viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

  const AUCTION = {
    // 1 double: two stacked panels (an "=" sign)
    1: svg('<rect x="9" y="12" width="30" height="9" rx="2"/><rect x="9" y="27" width="30" height="9" rx="2"/>'),
    // 2 hidden: a sealed bid — filled disc inside a ring
    2: svg('<circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="10" fill="currentColor" stroke="none"/>'),
    // 3 fixed price: $ in a diamond
    3: svg('<path d="M24 5 43 24 24 43 5 24Z"/><path d="M29 18.5c-1-1.8-3-2.7-5-2.7-2.9 0-5 1.5-5 3.8 0 5.3 10.4 3 10.4 8.6 0 2.4-2.3 4-5.4 4-2.3 0-4.4-1-5.4-2.9M24 13v3M24 32v3" stroke-width="2.6"/>'),
    // 4 once around: circular arrow in a diamond
    4: svg('<path d="M24 5 43 24 24 43 5 24Z"/><path d="M30.5 20.5a7.5 7.5 0 1 0 .2 6.3" stroke-width="2.6"/><path d="M31.5 14.5v6.5H25" stroke-width="2.6"/>'),
    // 5 open: four-way arrows in a circle
    5: svg('<circle cx="24" cy="24" r="18"/><path d="M24 12v24M12 24h24M24 12l-4 4M24 12l4 4M24 36l-4-4M24 36l4-4M12 24l4-4M12 24l4 4M36 24l-4-4M36 24l-4 4" stroke-width="2.6"/>'),
  };

  const UI = {
    history: svg('<path d="M8 12h32M8 24h32M8 36h20"/>'),
    rules: svg('<circle cx="24" cy="24" r="18"/><path d="M19 19a5 5 0 1 1 7 4.6c-1.3.6-2 1.6-2 3V28"/><circle cx="24" cy="34" r="1.2" fill="currentColor"/>'),
    menu: svg('<path d="M24 10v28M10 24h28"/>'),
    cards: svg('<rect x="10" y="8" width="20" height="28" rx="3"/><path d="M18 40h16a3 3 0 0 0 3-3V15"/>', 48),
    bulb: svg('<path d="M18 34h12M20 40h8M24 6a12 12 0 0 0-7 21.7c1.3 1 2 2.4 2 4V34h10v-2.3c0-1.6.7-3 2-4A12 12 0 0 0 24 6Z"/>'),
    gavel: svg('<path d="m26 8 12 12M20 14l12 12M23 11l9 9M14 38h20M28 20 12 36"/>'),
  };

  const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true">
    <rect x="3" y="3" width="20" height="26" rx="3" fill="#fe5688"/>
    <rect x="25" y="3" width="20" height="16" rx="3" fill="#ffd84d"/>
    <rect x="25" y="21" width="20" height="24" rx="3" fill="#7c6cf2"/>
    <rect x="3" y="31" width="20" height="14" rx="3" fill="#2fd38a"/></svg>`;

  window.MA_ICONS = { AUCTION, UI, LOGO };
})();
