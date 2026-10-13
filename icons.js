// Vector redraws of the original 49×49 auction-type bitmaps, plus UI icons.
// All use currentColor so they theme with CSS.
(function () {
  'use strict';
  const svg = (body, vb = 48) =>
    `<svg viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

  const AUCTION = {
    // 1 double: two stacked panels (an "=" sign)
    1: svg('<rect x="9" y="12" width="30" height="9" rx="2"/><rect x="9" y="27" width="30" height="9" rx="2"/>'),
    // 2 hidden: a filled disc inside a ring that is open on the left
    2: svg('<path d="M8.5 17.1A17 17 0 1 1 8.5 30.9"/><circle cx="24" cy="24" r="11.5" fill="currentColor" stroke="none"/>'),
    // 3 fixed price: $ in a diamond, with the corners of a square showing behind it
    3: svg('<path d="M24 4.5 43.5 24 24 43.5 4.5 24Z"/><path d="M17.9 10.6H10.6V17.9M30.1 10.6H37.4V17.9M37.4 30.1V37.4H30.1M10.6 30.1V37.4H17.9" stroke-width="2.4"/><path d="M24 8V40" stroke-width="2"/><path d="M29.5 18c-.9-1.9-2.9-3-5.4-3-3.2 0-5.4 1.7-5.4 4.2 0 5.9 11.2 3.4 11.2 9.6 0 2.6-2.4 4.4-5.8 4.4-2.6 0-4.8-1.1-5.8-3.2" stroke-width="2.8"/>'),
    // 4 once around: in a diamond, a circle open at the right, arrowhead pointing down on the right
    4: svg('<path d="M24 4.5 43.5 24 24 43.5 4.5 24Z"/><path d="M28.6 31.6A9 9 0 1 1 32.2 21.5" stroke-width="2.8"/><path d="M28.4 21.2H36L32.2 27.2Z" fill="currentColor" stroke-width="1.5"/>'),
    // 5 open: four-way arrows with solid heads, in a circle
    5: svg('<circle cx="24" cy="24" r="18"/><path d="M24 15V33M15 24H33" stroke-width="3"/><path d="M24 9.5 19.8 15.5H28.2ZM24 38.5 19.8 32.5H28.2ZM9.5 24 15.5 19.8V28.2ZM38.5 24 32.5 19.8V28.2Z" fill="currentColor" stroke-width="1.2"/>'),
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
