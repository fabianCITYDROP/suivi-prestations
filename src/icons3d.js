// Icônes en volume des anomalies « Signaler » (pare-brise, éponge, pneus…), dessinées en SVG (viewBox 48).
// Les dégradés sont déclarés une seule fois dans la page (DEFS), puis chaque icône s'y réfère.
// Voyant allumé : deux calques, .i3-off (éteint) et .i3-on (allumé) ; la tuile n'allume le voyant que quand il est choisi.
(function (root) {
  // Icônes en volume, viewBox 48. Les dégradés (ids i3-*) sont définis une seule fois dans DEFS.
  const O = '#26353f'; // contour
  const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
  <linearGradient id="i3-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfd8df"/></linearGradient>
  <linearGradient id="i3-side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9eef2"/><stop offset="1" stop-color="#b9c5ce"/></linearGradient>
  <linearGradient id="i3-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a7d95"/><stop offset="1" stop-color="#1b2c39"/></linearGradient>
  <linearGradient id="i3-mglass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9dfec"/><stop offset=".55" stop-color="#86a9c0"/><stop offset="1" stop-color="#5b7f98"/></linearGradient>
  <radialGradient id="i3-tyre" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#4a545c"/><stop offset="1" stop-color="#101519"/></radialGradient>
  <radialGradient id="i3-rim" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#9aa6b0"/></radialGradient>
  <linearGradient id="i3-spy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd23f"/><stop offset="1" stop-color="#e39a00"/></linearGradient>
  <linearGradient id="i3-spy-side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8a800"/><stop offset="1" stop-color="#c07d00"/></linearGradient>
  <linearGradient id="i3-spg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4cc46e"/><stop offset="1" stop-color="#1f8a48"/></linearGradient>
  <radialGradient id="i3-foam" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#eef4f8"/><stop offset="1" stop-color="#c8d7e2"/></radialGradient>
  <radialGradient id="i3-dash" cx=".5" cy=".3" r=".8"><stop offset="0" stop-color="#34424d"/><stop offset="1" stop-color="#0d141a"/></radialGradient>
  <radialGradient id="i3-amber" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#f08c00"/></radialGradient>
  <radialGradient id="i3-ground" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#0a141c" stop-opacity=".32"/><stop offset="1" stop-color="#0a141c" stop-opacity="0"/></radialGradient>
  <filter id="i3-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="1.6"/></filter>
  <radialGradient id="i3-dent" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#8f9ca6"/><stop offset="1" stop-color="#e4e9ed" stop-opacity="0"/></radialGradient>
  <linearGradient id="i3-dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5864"/><stop offset="1" stop-color="#232e36"/></linearGradient>
  <linearGradient id="i3-spg-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7ddc98"/><stop offset="1" stop-color="#4cbf6c"/></linearGradient>
  </defs></svg>`;
  const ground = (cx, cy, rx, ry = 2.2) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#i3-ground)"/>`;
  const S = `stroke="${O}" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"`;
  const RED = '#e0392b';
  const wheel = (cx, cy, hot) => `<ellipse cx="${cx}" cy="${cy+4.9}" rx="4.4" ry="1" fill="#0a141c" opacity=".28"/>` + (hot ? `<circle cx="${cx}" cy="${cy}" r="6.6" fill="none" stroke="${RED}" stroke-width="1.8"/><path d="M${cx-6} ${cy+6.2}l-1.4 1.4M${cx} ${cy+8.4}v1.8M${cx+6} ${cy+6.2}l1.4 1.4" stroke="${RED}" stroke-width="1.6" stroke-linecap="round"/>` : '') +
    `<circle cx="${cx}" cy="${cy}" r="4.6" fill="url(#i3-tyre)" ${S}/><circle cx="${cx}" cy="${cy}" r="2.2" fill="url(#i3-rim)"/><circle cx="${cx}" cy="${cy}" r=".7" fill="#5b6873"/>`;
  const van = (front) => ground(24, 41, 22, 2) +
    // caisse
    `<path d="M4 11.5a2.5 2.5 0 0 1 2.5-2.5h21a2.5 2.5 0 0 1 2.5 2.5V33H4Z" fill="url(#i3-body)" ${S}/>` +
    `<path d="M5.5 11.2h23" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".9"/>` +
    `<path d="M4 29.5h26" stroke="#b3bfc8" stroke-width="1"/><path d="M5.8 20.5v4" stroke="#8d9aa4" stroke-width="1.1" stroke-linecap="round"/>` +
    // cabine
    `<path d="M30 15.5h7.8c.9 0 1.7.4 2.2 1.2l3.7 5.7c.5.7.8 1.6.8 2.5V33H30Z" fill="url(#i3-side)" ${S}/>` +
    `<path d="M33 18h4.6c.5 0 .9.2 1.2.6l2.7 4.6H33Z" fill="url(#i3-glass)" ${S}/>` +
    `<path d="M34.3 18.4h1.6l-2 4.4h-1.2Z" fill="#fff" opacity=".35"/>` +
    `<path d="M33.5 26.3h2.6" stroke="${O}" stroke-width="1.1" stroke-linecap="round"/><path d="M32.4 18v14.6" stroke="#a5b2bc" stroke-width=".8"/>` +
    `<path d="M41.6 19.6l1.6-.4v3.4l-1.6-.2" fill="url(#i3-dark)" ${S}/>` +
    `<rect x="7.5" y="14" width="9.5" height="4.2" rx="1.2" fill="#0f6f8f"/><circle cx="14.9" cy="16.1" r="1" fill="#ffd23f"/><path d="M9.2 16.1h3.4" stroke="#fff" stroke-width=".9" stroke-linecap="round"/>` +
    `<path d="M6.5 32.8a5.6 5.6 0 0 1 11 0M31 32.8a5.6 5.6 0 0 1 11 0" fill="#1d262d"/>` +
    `<rect x="42.4" y="25.6" width="2" height="2.6" rx=".8" fill="#ffd23f" stroke="${O}" stroke-width=".8"/>` +
    // châssis
    `<path d="M3.5 33h41.3v1.6a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1Z" fill="url(#i3-dark)" ${S}/>` +
    wheel(12, 35.2, !front) + wheel(36.5, 35.2, front);
  const ICONS = {
    "Pare-brise": ground(24, 43, 18) +
      `<path d="M9.6 19.5H6.8M38.4 19.5h2.8" stroke="${O}" stroke-width="1.4" stroke-linecap="round"/>` +
      `<rect x="3.6" y="16.4" width="4.4" height="6.6" rx="1.6" fill="url(#i3-side)" ${S}/><rect x="40" y="16.4" width="4.4" height="6.6" rx="1.6" fill="url(#i3-side)" ${S}/>` +
      `<rect x="11" y="36" width="6" height="5.6" rx="1.6" fill="url(#i3-tyre)" ${S}/><rect x="31" y="36" width="6" height="5.6" rx="1.6" fill="url(#i3-tyre)" ${S}/>` +
      `<path d="M9 21.5c0-6.2 3.1-9.8 8.6-10.3h12.8c5.5.5 8.6 4.1 8.6 10.3V34H9Z" fill="url(#i3-body)" ${S}/>` +
      `<path d="M9.5 22v11.5h2.2V21.2ZM38.5 22v11.5h-2.2V21.2Z" fill="#0a141c" opacity=".07"/>` +
      `<path d="M12.6 14.8Q24 12.8 35.4 14.8L37 25.6Q24 24.2 11 25.6Z" fill="url(#i3-glass)" ${S}/>` +
      `<path d="M15.8 14.3l3.8-.5-4.9 11.3-2.5.3Z" fill="#fff" opacity=".24"/><path d="M21.4 13.6l1.5-.1-4.6 11.5-1.5.1Z" fill="#fff" opacity=".14"/>` +
      `<path d="M14.2 24.8l7.6-4.2" stroke="#0e171e" stroke-width="1.2" stroke-linecap="round"/>` +
      `<g stroke="${RED}" stroke-linecap="round" fill="none"><circle cx="29.2" cy="19.4" r="1.8" stroke-width="1.4" fill="#fff" fill-opacity=".3"/><path d="M30.8 18.3l3-2.3M31.1 20.2l3.8 1.1M29.7 21.2l.6 2.6M27.5 20.3l-2.6 1.5M28.3 17.7l-.9-2.2" stroke-width="1.1"/></g>` +
      `<path d="M11.4 28.4h6.2l-1.2 3.2h-4.4a.8.8 0 0 1-.8-.8v-1.6c0-.5.1-.8.2-.8ZM36.6 28.4h-6.2l1.2 3.2h4.4c.4 0 .8-.4.8-.8v-1.6c0-.5-.1-.8-.2-.8Z" fill="#fff" ${S}/>` +
      `<path d="M12.6 29.5h3.6" stroke="#ffd23f" stroke-width="1" stroke-linecap="round"/><path d="M31.8 29.5h3.6" stroke="#ffd23f" stroke-width="1" stroke-linecap="round"/>` +
      `<rect x="19.2" y="28.2" width="9.6" height="3.8" rx="1.3" fill="url(#i3-dark)" ${S}/><path d="M20.8 29.6h6.4M20.8 30.8h6.4" stroke="#6b7884" stroke-width=".7" stroke-linecap="round"/>` +
      `<rect x="8" y="33.2" width="32" height="4.6" rx="2" fill="url(#i3-dark)" ${S}/><rect x="20" y="34.3" width="8" height="2.4" rx=".6" fill="#fff" stroke="#9aa6b0" stroke-width=".5"/><path d="M20.4 34.5v2" stroke="#2f62c8" stroke-width=".9"/>`,
    "Véhicule sale": ground(23, 42, 19) +
      // éponge : couche verte (grattoir) sur bloc jaune, en perspective
      `<path d="M7 26h27v11.5a1.5 1.5 0 0 1-1.5 1.5H8.5A1.5 1.5 0 0 1 7 37.5Z" fill="url(#i3-spy)" ${S}/>` +
      `<path d="M34 26l6-5.5v11.4c0 .5-.2.9-.5 1.2L34 38.5Z" fill="url(#i3-spy-side)" ${S}/>` +
      `<path d="M7 26v-3.6h27V26ZM34 26v-3.6l6-5.5V20.5Z" fill="url(#i3-spg)" ${S}/>` +
      `<path d="M7 22.4l6-5.5h27l-6 5.5Z" fill="url(#i3-spg-top)" ${S}/>` +
      `<g fill="#1f8a48" opacity=".35"><circle cx="15" cy="20.6" r=".45"/><circle cx="31.5" cy="19.2" r=".45"/><circle cx="37" cy="18.4" r=".45"/></g>` +
      `<path d="M8 25.3h25" stroke="#8be3a6" stroke-width=".8" stroke-linecap="round"/><path d="M8.2 27h24.6" stroke="#ffe680" stroke-width=".9" stroke-linecap="round"/>` +
      `<g fill="#c98a00" opacity=".75"><ellipse cx="11.5" cy="30" rx="1.1" ry=".8"/><ellipse cx="16.5" cy="33.5" rx=".9" ry=".7"/><ellipse cx="21" cy="29.6" rx="1.2" ry=".8"/><ellipse cx="26" cy="34" rx="1" ry=".7"/><ellipse cx="30" cy="30.2" rx=".8" ry=".6"/><ellipse cx="12.5" cy="35.6" rx=".7" ry=".5"/><ellipse cx="21.5" cy="36" rx=".8" ry=".5"/><ellipse cx="37" cy="28" rx=".6" ry=".9"/></g>` +
      // mousse
      `<g fill="url(#i3-foam)" ${S}><circle cx="14" cy="17.5" r="4.6"/><circle cx="21.5" cy="14.2" r="6"/><circle cx="29.5" cy="16" r="5"/><circle cx="35" cy="18.6" r="3.4"/></g>` +
      
      `<g fill="#fff"><circle cx="19.5" cy="11.6" r="1.4" opacity=".95"/><circle cx="27.8" cy="13.6" r="1" opacity=".95"/><circle cx="12.6" cy="16" r=".9" opacity=".95"/><circle cx="34.2" cy="17.6" r=".6" opacity=".95"/></g>` +
      `<g fill="url(#i3-foam)" ${S}><circle cx="39.5" cy="9.5" r="2.6"/><circle cx="34.5" cy="6" r="1.6"/><circle cx="42.5" cy="15" r="1.2"/></g>` +
      `<circle cx="38.7" cy="8.7" r=".8" fill="#fff"/>`,
    "Pneu avant": van(true),
    "Pneu arrière": van(false),
    "Rétro cassé": ground(24, 43, 16, 2) +
      // bras et portière
      `<path d="M36 21h5.5a3 3 0 0 1 3 3v12.5h-4V25.5H36Z" fill="url(#i3-side)" ${S}/>` +
      `<path d="M38.6 36.5h7.6l-1 4.2h-6.4Z" fill="url(#i3-dark)" ${S}/>` +
      // coque arrière (profondeur)
      `<path d="M7.5 20c0-7 3.8-10.5 10-10.5h14c6 0 9.5 4 9.5 9.5v6c0 6.5-4 10.5-10 10.5h-13C11 35.5 7.5 31.5 7.5 25Z" fill="#aebbc5" ${S}/>` +
      `<path d="M5 18.5C5 12 8.8 8 15 8h14c6 0 10 4 10 9.5v6c0 6.5-4 10.5-10.5 10.5h-12C9 34 5 30 5 23.5Z" fill="url(#i3-body)" ${S}/>` +
      `<path d="M8.6 18.8c0-4.6 2.6-7.4 7-7.4h12.6c4.3 0 7.3 2.8 7.3 6.6v5.6c0 4.6-3 7.5-7.6 7.5H16c-4.6 0-7.4-2.9-7.4-7.6Z" fill="url(#i3-mglass)" ${S}/>` +
      `<path d="M12 12.6l5.5-.9-6.2 15.5-1.8-2Z" fill="#fff" opacity=".35"/><path d="M10.4 17.6c.4-3.4 2.4-5 5.4-5" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".8"/>` +
      `<g fill="none" stroke="#14212b" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.6l-2.6 5.6 3.8 2.6-3.2 4.8 2.2 3-1.4 3.6"/><path d="M21.7 19.8l5.6-2.2 2.8-5"/><path d="M20.4 24.6l6.6 1.4 3.4 4"/><path d="M27.3 17.6l7 .8"/></g>` +
      `<g fill="none" stroke="#fff" stroke-width=".6" stroke-linecap="round" opacity=".7"><path d="M21.2 12.4l-2.3 5"/><path d="M22.5 20.4l4.6-1.8"/></g>`,
    "Carrosserie": ground(24, 39.5, 22, 1.8) +
      `<g transform="scale(2)"><path d="M4 16.5H2.6a.8.8 0 0 1-.8-.8v-2.3c0-.9.6-1.6 1.5-1.8l3.5-.8 2.9-3a2.4 2.4 0 0 1 1.7-.8h5.1c.8 0 1.5.4 2 1l2.3 2.9 1.7.4c.9.2 1.6 1 1.6 2v2.4a.8.8 0 0 1-.8.8H20a2.5 2.5 0 0 0-5 0H9a2.5 2.5 0 0 0-5 0Z" fill="url(#i3-body)" stroke="${O}" stroke-width=".55" stroke-linejoin="round"/>` +
      `<path d="M4.4 16.5a2.1 2.1 0 0 1 4.2 0ZM15.4 16.5a2.1 2.1 0 0 1 4.2 0Z" fill="#3a4752"/>` +
      `<path d="M8.6 11.3l1.9-2.1c.2-.2.5-.4.8-.4h1.6v2.5ZM14.2 8.8h2c.4 0 .7.2.9.5l1.6 2h-4.5Z" fill="url(#i3-glass)" stroke="${O}" stroke-width=".5" stroke-linejoin="round"/>` +
      `<path d="M10.6 9.4l.9-.6-1.5 2.5h-.8ZM15 8.9h.8l-1 2.4h-.6Z" fill="#fff" opacity=".35"/>` +
      `<path d="M2.4 13.6h19.4" stroke="#fff" stroke-width=".45" opacity=".9"/><path d="M13.6 11.4v4.9" stroke="#a9b6c0" stroke-width=".4"/>` +
      `<path d="M1.9 15.2h2.3M19.9 15.2h2.3" stroke="#3a4752" stroke-width="1.1" stroke-linecap="round"/><path d="M9 16.2h6" stroke="#9aa7b1" stroke-width=".8"/>` +
      `<path d="M8.4 11.4v4.9M18.4 11.4c.3 1.6.3 3.3 0 4.9" stroke="#a9b6c0" stroke-width=".4" fill="none"/><path d="M8 11.9l-.9-.4v1.2h1" fill="#3a4752"/>` +
      `<path d="M9.6 12.6h1M14.4 12.6h1" stroke="${O}" stroke-width=".5" stroke-linecap="round"/><rect x="20.5" y="12.3" width="1.3" height=".9" rx=".3" fill="#ffd23f"/><rect x="1.9" y="12.4" width="1" height=".8" rx=".3" fill="${RED}"/></g>` +
      `<ellipse cx="22.5" cy="27" rx="4.2" ry="2.6" fill="url(#i3-dent)"/><g stroke="${RED}" stroke-width="1.3" stroke-linecap="round" fill="none"><path d="M18.8 25.4l7.6 1.6M19.6 27.4l5.8 1.2" stroke-width="1.1"/></g>`,
    "Voyant allumé":
      `<circle cx="24" cy="24" r="18.5" fill="url(#i3-dash)" stroke="#0a1015" stroke-width="1"/><circle cx="24" cy="24" r="17.6" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="1"/>` +
      `<g transform="translate(5.3 5.6) scale(1.55)"><g class="i3-off"><path d="M7 8h8.5l2 2.2H19V8.6h2v7.8h-2v-1.6h-1.5l-2.6 3.2H9.6L7 15.6Z" fill="#3e4b56" stroke="#5f6d78" stroke-width=".7" stroke-linejoin="round"/><path d="M9.5 5.5h5M12 5.5v2.5M7 12.2H4.6M4.6 9.7v5" fill="none" stroke="#5f6d78" stroke-width="1.3" stroke-linecap="round"/></g>` +
      `<g class="i3-on"><g filter="url(#i3-glow)" opacity=".9"><path d="M7 8h8.5l2 2.2H19V8.6h2v7.8h-2v-1.6h-1.5l-2.6 3.2H9.6L7 15.6Z M9.5 5.5h5M12 5.5v2.5M7 12.2H4.6M4.6 9.7v5" fill="#ff9d1a" stroke="#ff9d1a" stroke-width="1.4"/></g>` +
      `<path d="M7 8h8.5l2 2.2H19V8.6h2v7.8h-2v-1.6h-1.5l-2.6 3.2H9.6L7 15.6Z" fill="url(#i3-amber)" stroke="#ffcf6e" stroke-width=".7" stroke-linejoin="round"/><path d="M9.5 5.5h5M12 5.5v2.5M7 12.2H4.6M4.6 9.7v5" fill="none" stroke="#ffb53d" stroke-width="1.3" stroke-linecap="round"/></g></g>` +
      `<path d="M12 15a14 14 0 0 1 24 0" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.4" stroke-linecap="round"/>`,
    "Autre": ground(24, 42, 14, 1.8) +
      `<circle cx="24" cy="23" r="16" fill="url(#i3-body)" ${S}/><path d="M13 17a13 13 0 0 1 22 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>` +
      `<g fill="#2a3945"><circle cx="16.5" cy="23" r="2.4"/><circle cx="24" cy="23" r="2.4"/><circle cx="31.5" cy="23" r="2.4"/></g>`,
  };
  let ready = false;
  const ensureDefs = () => { if (!ready && typeof document !== "undefined" && document.body) { document.body.insertAdjacentHTML("afterbegin", DEFS); ready = true; } };
  const art = (q, cls = "issue-art") => { ensureDefs(); return ICONS[q] ? `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${ICONS[q]}</svg>` : ""; };
  root.IssueArt = { art, has: (q) => !!ICONS[q] };
})(typeof self !== "undefined" ? self : this);
