// Icônes en volume des anomalies « Signaler » (pare-brise, éponge, pneus…), dessinées en SVG (viewBox 48).
// Une seule lumière, en haut à gauche : chaque pièce a son dégradé, un reflet clair en haut et une ombre à droite et en bas.
// Les dégradés sont déclarés une seule fois dans la page (DEFS), puis chaque icône s'y réfère.
// Voyant allumé : deux calques, .i3-off (éteint) et .i3-on (allumé) ; la tuile n'allume le voyant que quand il est choisi.
(function (root) {
  const O = "#24333e"; // contour
  const RED = "#e0392b";
  const lin = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="i3-${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</linearGradient>`;
  const rad = (id, stops, cx = 0.35, cy = 0.3, r = 0.75) => `<radialGradient id="i3-${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</radialGradient>`;
  const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
${lin("body", [[0, "#ffffff"], [0.55, "#e9eef2"], [1, "#bcc8d1"]])}
${lin("cab", [[0, "#f7f9fb"], [0.5, "#dfe6eb"], [1, "#aebbc6"]])}
${lin("shadeR", [[0, "#0a141c", 0], [0.62, "#0a141c", 0], [1, "#0a141c", 0.2]], 1, 0)}
${lin("shadeB", [[0, "#0a141c", 0], [0.6, "#0a141c", 0], [1, "#0a141c", 0.22]])}
${lin("shine", [[0, "#ffffff", 0.95], [1, "#ffffff", 0]])}
${lin("glass", [[0, "#7a9cb3"], [0.45, "#34526a"], [1, "#142330"]], 1, 1)}
${lin("mglass", [[0, "#e2eff7"], [0.45, "#9dbdd2"], [1, "#4f7590"]], 1, 1)}
${lin("dark", [[0, "#56636e"], [0.5, "#323e48"], [1, "#1b242b"]])}
${rad("tyre", [[0, "#3c464e"], [0.7, "#1d252b"], [1, "#0c1115"]], 0.4, 0.35, 0.65)}
${rad("rim", [[0, "#ffffff"], [0.55, "#cfd7dd"], [1, "#7e8b96"]], 0.35, 0.3, 0.8)}
${lin("spy", [[0, "#ffe27a"], [0.5, "#fbc935"], [1, "#e19a00"]])}
${lin("spy-side", [[0, "#e7a70e"], [1, "#b47300"]])}
${lin("spg", [[0, "#4fc272"], [1, "#1c7d41"]])}
${lin("spg-top", [[0, "#a6ecb9"], [1, "#55c677"]], 1, 1)}
${rad("foam", [[0, "#ffffff"], [0.6, "#f1f6f9"], [1, "#b8cad8"]], 0.35, 0.3, 0.8)}
${rad("drop", [[0, "#d9f1ff"], [1, "#4aa3d8"]], 0.35, 0.3, 0.8)}
${lin("bezel", [[0, "#eef2f5"], [0.45, "#8996a1"], [0.55, "#5d6a75"], [1, "#d3dbe1"]], 0.3, 1)}
${rad("dash", [[0, "#33414c"], [1, "#0b1217"]], 0.5, 0.3, 0.8)}
${rad("amber", [[0, "#ffe2a0"], [0.5, "#ffb53d"], [1, "#e87b00"]], 0.45, 0.35, 0.75)}
${rad("ground", [[0, "#0a141c", 0.34], [1, "#0a141c", 0]], 0.5, 0.5, 0.5)}
${rad("dent", [[0, "#7f8d98"], [0.6, "#b9c4cc", 0.6], [1, "#e4e9ed", 0]], 0.42, 0.4, 0.6)}
${lin("btn", [[0, "#ffffff"], [1, "#d3dbe1"]])}
${lin("steel", [[0, "#fbfcfd"], [0.5, "#c3ccd3"], [1, "#7d8a95"]])}
${lin("grip", [[0, "#3a9cc0"], [0.5, "#0f6f8f"], [1, "#0a4a60"]])}
${lin("cal-top", [[0, "#3a9cc0"], [0.55, "#0f6f8f"], [1, "#0a4e66"]])}
${lin("warn", [[0, "#ff8a7a"], [0.5, "#e5412f"], [1, "#a8231a"]])}
${lin("ora", [[0, "#ffd08a"], [0.5, "#f59e1b"], [1, "#c46d00"]])}
<mask id="i3-jaw" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48"><rect width="48" height="48" fill="#fff"/><path d="M37 21.3h12v5.4H37Z" fill="#000"/><circle cx="37" cy="24" r="2.7" fill="#000"/></mask>
<filter id="i3-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="1.6"/></filter>
</defs></svg>`;
  const S = `stroke="${O}" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"`;
  const ground = (cx, cy, rx, ry = 2.2) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#i3-ground)"/>`;
  // Une pièce en volume : dégradé, puis ombre à droite et en bas par-dessus, puis contour.
  const solid = (d, fill = "body") => `<path d="${d}" fill="url(#i3-${fill})"/><path d="${d}" fill="url(#i3-shadeR)"/><path d="${d}" fill="url(#i3-shadeB)"/><path d="${d}" fill="none" ${S}/>`;
  const wheel = (cx, cy, hot) =>
    `<ellipse cx="${cx}" cy="${cy + 5}" rx="4.8" ry="1.1" fill="#0a141c" opacity=".3"/>` +
    (hot ? `<circle cx="${cx}" cy="${cy}" r="7" fill="${RED}" fill-opacity=".1" stroke="${RED}" stroke-width="1.8"/><path d="M${cx - 6.3} ${cy + 6.5}l-1.4 1.4M${cx} ${cy + 8.8}v1.8M${cx + 6.3} ${cy + 6.5}l1.4 1.4" stroke="${RED}" stroke-width="1.6" stroke-linecap="round"/>` : "") +
    `<circle cx="${cx}" cy="${cy}" r="5" fill="url(#i3-tyre)" ${S}/><circle cx="${cx}" cy="${cy}" r="3.9" fill="none" stroke="#46525b" stroke-width=".6"/>` +
    `<circle cx="${cx}" cy="${cy}" r="2.7" fill="url(#i3-rim)" stroke="#5d6a74" stroke-width=".5"/>` +
    [0, 72, 144, 216, 288].map((a) => { const r = (a - 90) * Math.PI / 180; return `<circle cx="${(cx + 1.6 * Math.cos(r)).toFixed(2)}" cy="${(cy + 1.6 * Math.sin(r)).toFixed(2)}" r=".42" fill="#6b7883"/>`; }).join("") +
    `<circle cx="${cx}" cy="${cy}" r=".7" fill="#3d4952"/><path d="M${cx - 3.6} ${cy - 2.2}a4.2 4.2 0 0 1 3-2" stroke="#fff" stroke-opacity=".35" stroke-width=".7" fill="none" stroke-linecap="round"/>`;
  const van = (front, mark = true) => ground(24, 41.6, 22, 2.1) +
    // caisse : volume, nervures, logo City-Drop, poignée de porte arrière
    solid("M3.5 11a2.5 2.5 0 0 1 2.5-2.5h22a2.5 2.5 0 0 1 2.5 2.5v22h-27Z") +
    `<path d="M5 9.9h23" stroke="url(#i3-shine)" stroke-width="1.2" stroke-linecap="round"/><path d="M5.2 10.2h22.6" stroke="#fff" stroke-width=".8" stroke-linecap="round"/>` +
    `<path d="M12 11.5v17M19.5 11.5v17" stroke="#b7c3cc" stroke-width=".5"/><path d="M12.4 11.5v17M19.9 11.5v17" stroke="#fff" stroke-width=".4" opacity=".8"/>` +
    `<path d="M3.5 29.2h27" stroke="#a9b6c0" stroke-width=".9"/>` +
    `<path d="M5.4 19.6v4.6" stroke="#7d8a95" stroke-width="1.2" stroke-linecap="round"/>` +
    `<rect x="13.6" y="14" width="10.6" height="4.4" rx="1.3" fill="#0f6f8f"/><path d="M13.9 14.6h10" stroke="#fff" stroke-opacity=".3" stroke-width=".6" stroke-linecap="round"/><circle cx="22.1" cy="16.2" r="1.05" fill="#ffd23f"/><path d="M15.4 16.2h4.1" stroke="#fff" stroke-width=".95" stroke-linecap="round"/>` +
    // cabine : nez arrondi, vitre avec reflet, porte, rétro, phare
    solid("M30.5 15h7.6c1 0 1.9.5 2.4 1.3l3.6 5.6c.5.8.9 1.8.9 2.8V33H30.5Z", "cab") +
    `<path d="M33.2 17.6h4.8c.5 0 1 .3 1.3.7l2.8 4.7h-8.9Z" fill="url(#i3-glass)" ${S}/>` +
    `<path d="M34.6 17.9h1.9l-2.4 4.8h-1.1ZM37.3 17.9h.7l-2.4 4.8h-.6Z" fill="#fff" opacity=".4"/>` +
    `<path d="M32.4 17.4v14.9" stroke="#9aa7b2" stroke-width=".7"/><path d="M33.7 26.4h2.7" stroke="${O}" stroke-width="1.1" stroke-linecap="round"/>` +
    `<path d="M41.9 19.1l1.8-.5v3.8l-1.8-.2Z" fill="url(#i3-dark)" ${S}/>` +
    `<rect x="42.6" y="25.4" width="2.4" height="2.8" rx=".9" fill="#ffe08a" stroke="${O}" stroke-width=".7"/><path d="M43.1 26h.9" stroke="#fff" stroke-width=".5" stroke-linecap="round"/>` +
    // bas de caisse et passages de roue
    `<path d="M3 32.6h42.2v1.9c0 .6-.5 1.1-1.1 1.1H4.1A1.1 1.1 0 0 1 3 34.5Z" fill="url(#i3-dark)" ${S}/><path d="M4 33.2h40" stroke="#7d8a95" stroke-width=".5"/>` +
    `<path d="M6.4 33a6 6 0 0 1 12 0M30.7 33a6 6 0 0 1 12 0" fill="#151c21"/>` +
    wheel(12.4, 35.4, mark && !front) + wheel(36.7, 35.4, mark && front);
  const ENG = "M7 8h8.5l2 2.2H19V8.6h2v7.8h-2v-1.6h-1.5l-2.6 3.2H9.6L7 15.6Z";
  const PIPES = "M9.5 5.5h5M12 5.5v2.5M7 12.2H4.6M4.6 9.7v5";
  const CAR = "M4 16.5H2.6a.8.8 0 0 1-.8-.8v-2.3c0-.9.6-1.6 1.5-1.8l3.5-.8 2.9-3a2.4 2.4 0 0 1 1.7-.8h5.1c.8 0 1.5.4 2 1l2.3 2.9 1.7.4c.9.2 1.6 1 1.6 2v2.4a.8.8 0 0 1-.8.8H20a2.5 2.5 0 0 0-5 0H9a2.5 2.5 0 0 0-5 0Z";
  const ICONS = {
    "Pare-brise": ground(24, 43.4, 18.5, 2.3) +
      `<path d="M9.4 19.6H6.6M38.6 19.6h2.8" stroke="${O}" stroke-width="1.5" stroke-linecap="round"/>` +
      solid("M3.4 17.9a1.6 1.6 0 0 1 1.6-1.6h1.6a1.6 1.6 0 0 1 1.6 1.6v3.6a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6Z", "cab") +
      solid("M39.8 17.9a1.6 1.6 0 0 1 1.6-1.6H43a1.6 1.6 0 0 1 1.6 1.6v3.6A1.6 1.6 0 0 1 43 23.1h-1.6a1.6 1.6 0 0 1-1.6-1.6Z", "cab") +
      `<rect x="10.8" y="36" width="6.4" height="5.8" rx="1.7" fill="url(#i3-tyre)" ${S}/><rect x="30.8" y="36" width="6.4" height="5.8" rx="1.7" fill="url(#i3-tyre)" ${S}/>` +
      solid("M8.8 21.5c0-6.3 3.2-9.9 8.8-10.4h12.8c5.6.5 8.8 4.1 8.8 10.4V34H8.8Z") +
      `<path d="M12.2 12.6c1.6-.9 3.3-1.3 5.4-1.4h12.8" stroke="#fff" stroke-width="1" stroke-linecap="round" fill="none"/>` +
      // pare-brise : verre, reflets, joint
      `<path d="M12.4 14.8Q24 12.7 35.6 14.8L37.2 25.7Q24 24.2 10.8 25.7Z" fill="url(#i3-glass)" stroke="#121c24" stroke-width="1.3" stroke-linejoin="round"/>` +
      `<path d="M15.6 14.3l4.6-.6-5.6 11.4-3 .3Z" fill="#fff" opacity=".28"/><path d="M21.8 13.5l1.7-.1-5.2 11.5-1.7.1Z" fill="#fff" opacity=".16"/>` +
      `<path d="M13.8 25l8.2-4.5" stroke="#0b141a" stroke-width="1.4" stroke-linecap="round"/><circle cx="13.8" cy="25" r=".9" fill="#0b141a"/>` +
      `<g stroke-linecap="round" fill="none"><path d="M30.9 18.3l3.1-2.4M31.2 20.2l3.9 1.1M29.8 21.2l.6 2.7M27.6 20.3l-2.7 1.5M28.4 17.7l-.9-2.3" stroke="#fff" stroke-width="2" stroke-opacity=".35"/><circle cx="29.3" cy="19.4" r="1.9" stroke="${RED}" stroke-width="1.5" fill="#fff" fill-opacity=".35"/><path d="M30.9 18.3l3.1-2.4M31.2 20.2l3.9 1.1M29.8 21.2l.6 2.7M27.6 20.3l-2.7 1.5M28.4 17.7l-.9-2.3" stroke="${RED}" stroke-width="1.15"/></g>` +
      // capot, phares, calandre, pare-chocs, plaque
      `<path d="M10.2 27.3q13.8-1.5 27.6 0" stroke="#fff" stroke-width=".9" fill="none" opacity=".9"/><path d="M10.2 27.9q13.8-1.5 27.6 0" stroke="#aab7c1" stroke-width=".6" fill="none"/>` +
      `<path d="M11 28.6h6.6l-1.2 3.3h-4.7a.8.8 0 0 1-.8-.8Z" fill="#eaf3f9" ${S}/><path d="M37 28.6h-6.6l1.2 3.3h4.7c.4 0 .8-.4.8-.8Z" fill="#eaf3f9" ${S}/>` +
      `<path d="M12 29.6h4.4M31.6 29.6H36" stroke="#ffc53d" stroke-width="1.1" stroke-linecap="round"/><circle cx="13.2" cy="30.8" r=".6" fill="#fff"/><circle cx="34.8" cy="30.8" r=".6" fill="#fff"/>` +
      `<rect x="19" y="28.3" width="10" height="4" rx="1.4" fill="url(#i3-dark)" ${S}/><path d="M20.6 29.7h6.8M20.6 31h6.8" stroke="#77848f" stroke-width=".6" stroke-linecap="round"/><rect x="22.6" y="29.3" width="2.8" height="2" rx=".6" fill="#0f6f8f" stroke="#fff" stroke-width=".35"/>` +
      `<rect x="7.8" y="33.2" width="32.4" height="4.8" rx="2.1" fill="url(#i3-dark)" ${S}/><path d="M9.4 33.9h29.2" stroke="#8a97a2" stroke-width=".6" stroke-linecap="round"/>` +
      `<rect x="19.8" y="34.5" width="8.4" height="2.5" rx=".6" fill="#fff" stroke="#9aa6b0" stroke-width=".5"/><path d="M20.3 34.8v1.9" stroke="#2f62c8" stroke-width="1"/><path d="M21.6 35.75h5.6" stroke="#4a5864" stroke-width=".7" stroke-dasharray="1 .6"/>`,
    "Véhicule sale": ground(23.5, 42.4, 19, 2.3) +
      // bloc jaune
      solid("M7 26h27v11.2a1.8 1.8 0 0 1-1.8 1.8H8.8A1.8 1.8 0 0 1 7 37.2Z", "spy") +
      `<path d="M34 26l6-5.5v11.2c0 .6-.2 1.1-.6 1.4L34 38.2Z" fill="url(#i3-spy-side)" ${S}/>` +
      `<g fill="#b67600" opacity=".55"><ellipse cx="10.6" cy="30.1" rx="1.2" ry=".85"/><ellipse cx="15.4" cy="33.9" rx="1" ry=".75"/><ellipse cx="20.2" cy="29.7" rx="1.35" ry=".9"/><ellipse cx="25.6" cy="34.2" rx="1.1" ry=".8"/><ellipse cx="29.9" cy="30.4" rx=".85" ry=".65"/><ellipse cx="11.8" cy="35.8" rx=".7" ry=".5"/><ellipse cx="21.2" cy="36.3" rx=".8" ry=".55"/><ellipse cx="31.4" cy="35.9" rx=".7" ry=".5"/><ellipse cx="17.4" cy="31.2" rx=".55" ry=".4"/><ellipse cx="36.4" cy="27.6" rx=".55" ry=".85"/><ellipse cx="37.8" cy="32" rx=".5" ry=".8"/></g>` +
      `<g fill="#fff3c4" opacity=".9"><path d="M9.6 30.7a1.2 .6 0 0 0 2 0"/><path d="M19 30.4a1.3 .6 0 0 0 2.4 0"/><path d="M24.6 34.8a1.1 .5 0 0 0 2 0"/><path d="M14.5 34.5a1 .5 0 0 0 1.8 0"/></g>` +
      `<path d="M8.4 27.2h24.4" stroke="#fff6cf" stroke-width="1" stroke-linecap="round" opacity=".9"/>` +
      // grattoir vert
      `<path d="M7 26v-3.6h27V26Z" fill="url(#i3-spg)" ${S}/><path d="M34 26v-3.6l6-5.5V20.5Z" fill="#1d7a40" ${S}/>` +
      `<path d="M7 22.4l6-5.5h27l-6 5.5Z" fill="url(#i3-spg-top)" ${S}/>` +
      `<g fill="#1f8a48" opacity=".45"><circle cx="14.6" cy="20.8" r=".45"/><circle cx="30.8" cy="19.3" r=".45"/><circle cx="36.6" cy="18.5" r=".45"/><circle cx="19" cy="21.5" r=".35"/></g>` +
      `<path d="M8.3 23.3h25" stroke="#9be7b1" stroke-width=".7" stroke-linecap="round"/>` +
      // mousse et bulles
      `<g fill="url(#i3-foam)" ${S}><circle cx="13.6" cy="17.6" r="4.7"/><circle cx="35" cy="18.3" r="3.5"/><circle cx="29.4" cy="15.8" r="5.1"/><circle cx="21.4" cy="13.9" r="6.2"/></g>` +
      `<g fill="#fff"><ellipse cx="19.2" cy="11" rx="2" ry="1.3" transform="rotate(-25 19.2 11)"/><ellipse cx="27.6" cy="13.3" rx="1.4" ry=".9" transform="rotate(-25 27.6 13.3)"/><ellipse cx="11.9" cy="15.9" rx="1.2" ry=".8" transform="rotate(-25 11.9 15.9)"/><circle cx="34" cy="16.8" r=".7"/></g>` +
      `<g fill="url(#i3-foam)" ${S}><circle cx="39.4" cy="9.6" r="2.7"/><circle cx="34.4" cy="5.9" r="1.7"/><circle cx="42.6" cy="15.1" r="1.3"/></g>` +
      `<g fill="#fff"><circle cx="38.5" cy="8.6" r=".85"/><circle cx="33.9" cy="5.4" r=".5"/></g>` +
      `<path d="M4.6 29.4c0-1.3 1.6-3.4 1.6-3.4s1.6 2.1 1.6 3.4a1.6 1.6 0 0 1-3.2 0Z" fill="url(#i3-drop)" stroke="#2f6f97" stroke-width=".7"/><circle cx="5.7" cy="29.2" r=".45" fill="#fff"/>`,
    "Pneu avant": van(true),
    "Pneu arrière": van(false),
    "Rétro cassé": ground(24, 43.4, 16.5, 2.1) +
      // bras et platine
      solid("M35.6 20.6h5.9a3 3 0 0 1 3 3v13h-4V25.1h-4.9Z", "cab") +
      `<path d="M38.4 36.4h8l-1 4.5h-6.2Z" fill="url(#i3-dark)" ${S}/><path d="M39 37.1h6.8" stroke="#8a97a2" stroke-width=".5"/>` +
      // coque : épaisseur, face, reflet
      `<path d="M7.6 20c0-7 3.9-10.6 10.1-10.6h14c6.1 0 9.6 4.1 9.6 9.6v6.1c0 6.6-4.1 10.6-10.1 10.6h-13.1c-6.4 0-10.5-4.1-10.5-10.6Z" fill="#9eacb7" ${S}/>` +
      solid("M5 18.5C5 12 8.8 8 15 8h14c6 0 10 4 10 9.5v6c0 6.5-4 10.5-10.5 10.5h-12C9 34 5 30 5 23.5Z") +
      `<path d="M7.4 13.4C9 10.6 11.6 9.3 15 9.3h13" stroke="#fff" stroke-width="1.1" stroke-linecap="round" fill="none"/>` +
      // glace, reflets, fissure (inchangée)
      `<path d="M8.6 18.8c0-4.6 2.6-7.4 7-7.4h12.6c4.3 0 7.3 2.8 7.3 6.6v5.6c0 4.6-3 7.5-7.6 7.5H16c-4.6 0-7.4-2.9-7.4-7.6Z" fill="url(#i3-mglass)" stroke="#33434f" stroke-width="1.2" stroke-linejoin="round"/>` +
      `<path d="M11.8 12.4l6-1-6.7 16.6-2-2.2Z" fill="#fff" opacity=".42"/><path d="M19.6 11.4l1.6-.1-6.8 19.4h-1.4Z" fill="#fff" opacity=".2"/><path d="M35.4 21v2.6c0 4.6-3 7.5-7.6 7.5h-4" stroke="#2d4a5e" stroke-opacity=".35" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
      `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#fff" stroke-width="2.1" opacity=".45"><path d="M20.5 11.6l-2.6 5.6 3.8 2.6-3.2 4.8 2.2 3-1.4 3.6"/><path d="M21.7 19.8l5.6-2.2 2.8-5"/><path d="M20.4 24.6l6.6 1.4 3.4 4"/><path d="M27.3 17.6l7 .8"/></g><g stroke="#14212b" stroke-width="1.15"><path d="M20.5 11.6l-2.6 5.6 3.8 2.6-3.2 4.8 2.2 3-1.4 3.6"/><path d="M21.7 19.8l5.6-2.2 2.8-5"/><path d="M20.4 24.6l6.6 1.4 3.4 4"/><path d="M27.3 17.6l7 .8"/></g></g>`,
    "Carrosserie": ground(24, 39.8, 22, 1.9) +
      `<g transform="scale(2)">` +
      `<path d="${CAR}" fill="url(#i3-body)"/><path d="${CAR}" fill="url(#i3-shadeR)"/><path d="${CAR}" fill="url(#i3-shadeB)"/>` +
      `<path d="M2 14.4h20.2v1.3a.8.8 0 0 1-.8.8H20a2.5 2.5 0 0 0-5 0H9a2.5 2.5 0 0 0-5 0H2.6a.8.8 0 0 1-.8-.8Z" fill="#0a141c" opacity=".12"/>` +
      `<path d="${CAR}" fill="none" stroke="${O}" stroke-width=".5" stroke-linejoin="round"/>` +
      `<path d="M2.4 13.3h19.4" stroke="#fff" stroke-width=".5" stroke-linecap="round"/><path d="M2.6 13.7h19.2" stroke="#a6b3bd" stroke-width=".25"/>` +
      `<path d="M4.3 16.5a2.2 2.2 0 0 1 4.4 0ZM15.3 16.5a2.2 2.2 0 0 1 4.4 0Z" fill="#151c21"/><path d="M4.7 16.3a1.8 1.8 0 0 1 3.6 0M15.7 16.3a1.8 1.8 0 0 1 3.6 0" stroke="#3a4752" stroke-width=".35" fill="none"/>` +
      `<path d="M8.6 11.3l1.9-2.1c.2-.2.5-.4.8-.4h1.6v2.5ZM14.2 8.8h2c.4 0 .7.2.9.5l1.6 2h-4.5Z" fill="url(#i3-glass)" stroke="${O}" stroke-width=".45" stroke-linejoin="round"/>` +
      `<path d="M10.5 9.4l1-.6-1.6 2.5H9.1ZM15.1 8.9h.9l-1.1 2.4h-.7Z" fill="#fff" opacity=".42"/>` +
      `<path d="M13.6 11.3v5M8.5 11.5c-.2 1.6-.2 3.3 0 4.8M18.4 11.4c.3 1.6.3 3.3 0 4.9" stroke="#9aa8b2" stroke-width=".3" fill="none"/>` +
      `<path d="M9.7 12.6h1.1M14.6 12.6h1.1" stroke="${O}" stroke-width=".5" stroke-linecap="round"/>` +
      `<path d="M8 11.8l-.9-.4v1.2h1Z" fill="url(#i3-dark)"/>` +
      `<path d="M1.8 15.2h2.4M19.8 15.2h2.4" stroke="#2e3a43" stroke-width="1.1" stroke-linecap="round"/>` +
      `<rect x="20.5" y="12.2" width="1.4" height="1" rx=".35" fill="#ffe08a" stroke="${O}" stroke-width=".2"/><rect x="1.85" y="12.3" width="1.05" height=".9" rx=".3" fill="${RED}"/>` +
      `</g>` +
      `<ellipse cx="22.6" cy="27.1" rx="4.4" ry="2.7" fill="url(#i3-dent)"/><path d="M18.6 28.6c1.4 1.2 6.2 1.4 8 0" stroke="#fff" stroke-width=".9" fill="none" stroke-linecap="round" opacity=".9"/>` +
      `<g stroke="${RED}" stroke-width="1.15" stroke-linecap="round" fill="none"><path d="M18.6 25.4l7.6 1.6M19.4 27.4l5.8 1.2"/></g>`,
    "Voyant allumé":
      `<circle cx="24" cy="24" r="19.6" fill="url(#i3-bezel)" ${S}/>` +
      `<circle cx="24" cy="24" r="16.8" fill="url(#i3-dash)" stroke="#05090c" stroke-width="1"/>` +
      `<g transform="translate(5.6 5.8) scale(1.53)"><g class="i3-off"><path d="${ENG}" fill="#36434e" stroke="#5a6874" stroke-width=".7" stroke-linejoin="round"/><path d="${PIPES}" fill="none" stroke="#5a6874" stroke-width="1.3" stroke-linecap="round"/></g>` +
      `<g class="i3-on"><g filter="url(#i3-glow)" opacity=".9"><path d="${ENG} ${PIPES}" fill="#ff9d1a" stroke="#ff9d1a" stroke-width="1.4"/></g>` +
      `<path d="${ENG}" fill="url(#i3-amber)" stroke="#ffd27a" stroke-width=".7" stroke-linejoin="round"/><path d="${PIPES}" fill="none" stroke="#ffb53d" stroke-width="1.3" stroke-linecap="round"/></g></g>` +
      `<path d="M11.4 17.2A14 14 0 0 1 36.6 17.2C33 14.6 28.8 13.4 24 13.4s-9 1.2-12.6 3.8Z" fill="#fff" opacity=".1"/>`,
    "Autre": ground(24, 42.6, 14, 2) +
      `<circle cx="24" cy="23.4" r="16" fill="url(#i3-btn)" ${S}/><circle cx="24" cy="23.4" r="16" fill="url(#i3-shadeR)"/>` +
      `<ellipse cx="22" cy="14.6" rx="10" ry="4.4" fill="url(#i3-shine)" opacity=".9"/>` +
      `<g fill="#2a3945"><circle cx="16.5" cy="23.6" r="2.5"/><circle cx="24" cy="23.6" r="2.5"/><circle cx="31.5" cy="23.6" r="2.5"/></g>` +
      `<g fill="#fff" opacity=".55"><circle cx="15.8" cy="22.8" r=".7"/><circle cx="23.3" cy="22.8" r=".7"/><circle cx="30.8" cy="22.8" r=".7"/></g>`,
  };
  // Types de prestation (cartes de l'écran prestataire) : clé d'intervention et hayon élévateur.
  ICONS["svc-intervention"] = ground(24, 42.4, 15, 2.1) +
    `<g transform="rotate(-40 24 24)">` +
    // clé plate : tête ouverte à droite (masque), anneau à gauche, manche avec poignée bleue City-Drop
    `<g mask="url(#i3-jaw)">${solid("M29.5 24a7.5 7.5 0 1 1 15 0a7.5 7.5 0 1 1-15 0Z", "steel")}</g>` +
    solid("M8 21.2h24v5.6H8Z", "steel") +
    solid("M13.5 20.6h13.4a1.6 1.6 0 0 1 1.6 1.6v3.6a1.6 1.6 0 0 1-1.6 1.6H13.5a1.6 1.6 0 0 1-1.6-1.6v-3.6a1.6 1.6 0 0 1 1.6-1.6Z", "grip") +
    `<path d="M14 21.6h12.4" stroke="#fff" stroke-opacity=".45" stroke-width=".8" stroke-linecap="round"/><path d="M16 22.6v2.8M18.6 22.6v2.8M21.2 22.6v2.8M23.8 22.6v2.8" stroke="#0a3a4c" stroke-opacity=".45" stroke-width=".7" stroke-linecap="round"/>` +
    solid("M3.6 24a6 6 0 1 1 12 0a6 6 0 1 1-12 0Z", "steel") +
    `<path d="M9.6 20.6l2.95 1.7v3.4L9.6 27.4l-2.95-1.7v-3.4Z" fill="#33414c" stroke="${O}" stroke-width=".8" stroke-linejoin="round"/><path d="M6.65 22.3l2.95-1.7 2.95 1.7" stroke="#0a141c" stroke-width=".7" fill="none" opacity=".6"/>` +
    `<path d="M31.4 20.2a6.4 6.4 0 0 1 8.8-2.4" stroke="#fff" stroke-width="1" fill="none" stroke-linecap="round"/><path d="M5 21.4a4.8 4.8 0 0 1 4-2.6" stroke="#fff" stroke-width=".9" fill="none" stroke-linecap="round"/>` +
    `</g>`;
  ICONS["svc-hayon"] = `<g transform="translate(6.4 2.6) scale(.86)">${van(true, false)}</g>` +
    // hayon : bras, plateau baissé, flèche monte / descend
    `<path d="M9.6 30.2l-.4 7.6" stroke="${O}" stroke-width="1.6" stroke-linecap="round"/><path d="M9.6 30.2l-.4 7.6" stroke="#9aa7b2" stroke-width=".7" stroke-linecap="round"/>` +
    solid("M1.4 37.4h9.4v2.6H1.4Z", "steel") + `<path d="M2 37.9h8.2" stroke="#fff" stroke-width=".6" stroke-linecap="round"/>` +
    `<g stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M5.2 23.6v9.6M2.8 26l2.4-2.4 2.4 2.4M2.8 30.8l2.4 2.4 2.4-2.4" stroke="#fff" stroke-width="2.6" stroke-opacity=".7"/><path d="M5.2 23.6v9.6M2.8 26l2.4-2.4 2.4 2.4M2.8 30.8l2.4 2.4 2.4-2.4" stroke="#0f6f8f" stroke-width="1.5"/></g>`;
  // Actions d'une carte prestataire : reporter (calendrier + flèche), véhicule absent (place vide), problème (triangle).
  ICONS["act-date"] = ground(24, 43.2, 16, 2.1) +
    solid("M8 12.5a3.5 3.5 0 0 1 3.5-3.5h25a3.5 3.5 0 0 1 3.5 3.5V37a3.5 3.5 0 0 1-3.5 3.5h-25A3.5 3.5 0 0 1 8 37Z") +
    `<path d="M8 12.5a3.5 3.5 0 0 1 3.5-3.5h25a3.5 3.5 0 0 1 3.5 3.5V18H8Z" fill="url(#i3-cal-top)" ${S}/>` +
    `<path d="M10.4 10.6h27" stroke="#fff" stroke-opacity=".45" stroke-width=".9" stroke-linecap="round"/>` +
    `<g fill="url(#i3-dark)" ${S}><rect x="14" y="5.5" width="3.4" height="7.4" rx="1.7"/><rect x="30.6" y="5.5" width="3.4" height="7.4" rx="1.7"/></g>` +
    `<g fill="#c3ced6"><rect x="12.4" y="22" width="4.4" height="3.4" rx=".9"/><rect x="19.6" y="22" width="4.4" height="3.4" rx=".9"/><rect x="12.4" y="28.4" width="4.4" height="3.4" rx=".9"/></g>` +
    // flèche « plus tard » bleue
    `<path d="M22 33.6a8.4 8.4 0 1 0 2.2-10.4" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".9"/>` +
    `<path d="M22 33.6a8.4 8.4 0 1 0 2.2-10.4" fill="none" stroke="#0f6f8f" stroke-width="2.6" stroke-linecap="round"/>` +
    `<path d="M21.4 19.6l3.4 3.4-3.9 2.6Z" fill="#0f6f8f" stroke="#0f6f8f" stroke-width="1.6" stroke-linejoin="round"/>`;
  ICONS["act-absent"] = ground(24, 43, 20, 2) +
    // place de parking vide : bitume, lignes blanches, camion en pointillés
    `<path d="M4 40.5l5-21h30l5 21Z" fill="url(#i3-dark)" ${S}/><path d="M9.6 20.6h28.8" stroke="#8a97a2" stroke-width=".6"/>` +
    `<path d="M10.6 22.4l-3.8 16.6M37.4 22.4l3.8 16.6" stroke="#f4f7f9" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M14.6 25.4h18.8l1.4 10.6H13.2Z" fill="none" stroke="#f4f7f9" stroke-opacity=".75" stroke-width="1.1" stroke-dasharray="2.2 1.8" stroke-linejoin="round"/>` +
    // point d'interrogation orange, en volume
    `<circle cx="34.6" cy="13.4" r="8.4" fill="url(#i3-ora)" ${S}/><ellipse cx="32.6" cy="9.6" rx="4.6" ry="2.4" fill="url(#i3-shine)" opacity=".75"/>` +
    `<path d="M31.8 11.2a2.9 2.9 0 1 1 4.1 2.6c-.8.4-1.3 1-1.3 1.9v.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="34.6" cy="18.6" r="1.15" fill="#fff"/>`;
  ICONS["act-problem"] = ground(24, 42.8, 17, 2.1) +
    `<path d="M21.2 7.6a3.2 3.2 0 0 1 5.6 0l15.6 28a3.2 3.2 0 0 1-2.8 4.8H8.4a3.2 3.2 0 0 1-2.8-4.8Z" fill="url(#i3-warn)"/><path d="M21.2 7.6a3.2 3.2 0 0 1 5.6 0l15.6 28a3.2 3.2 0 0 1-2.8 4.8H8.4a3.2 3.2 0 0 1-2.8-4.8Z" fill="url(#i3-shadeR)"/>` +
    `<path d="M21.2 7.6a3.2 3.2 0 0 1 5.6 0l15.6 28a3.2 3.2 0 0 1-2.8 4.8H8.4a3.2 3.2 0 0 1-2.8-4.8Z" fill="none" stroke="#7d1810" stroke-width="1" stroke-linejoin="round"/>` +
    `<path d="M22.4 9.6a1.8 1.8 0 0 1 3.1 0l3 5.4c-2.6 1.6-6.4 1.9-9.4.9Z" fill="#fff" opacity=".35"/>` +
    `<rect x="22" y="17" width="4" height="12.4" rx="2" fill="#fff"/><circle cx="24" cy="34" r="2.2" fill="#fff"/>`;
  ICONS["faits-vide"] = ground(24, 43.2, 15, 2.1) +
    // « Faits » vide : un bloc-notes à pince, une pastille verte avec une coche
    solid("M10 10.5a3.5 3.5 0 0 1 3.5-3.5h21a3.5 3.5 0 0 1 3.5 3.5V38a3.5 3.5 0 0 1-3.5 3.5h-21A3.5 3.5 0 0 1 10 38Z") +
    `<path d="M12.6 9.2h22.6" stroke="#fff" stroke-opacity=".5" stroke-width=".9" stroke-linecap="round"/>` +
    `<path d="M17.5 4.8h13a1.6 1.6 0 0 1 1.6 1.6v3.4a1.6 1.6 0 0 1-1.6 1.6h-13a1.6 1.6 0 0 1-1.6-1.6V6.4a1.6 1.6 0 0 1 1.6-1.6Z" fill="url(#i3-steel)" ${S}/>` +
    `<g stroke="#c3ced6" stroke-width="2.2" stroke-linecap="round"><path d="M15.4 18h17"/><path d="M15.4 23.6h12"/><path d="M15.4 29.2h7"/></g>` +
    `<circle cx="32.4" cy="33.2" r="8.6" fill="url(#i3-spg)" ${S}/><ellipse cx="30.4" cy="29.4" rx="4.6" ry="2.3" fill="url(#i3-shine)" opacity=".7"/>` +
    `<path d="M28.4 33.4l2.8 2.8 5.2-5.6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  // « Pas possible » : panneau sens interdit en volume (refus d'une demande, à ne pas confondre avec « Problème »).
  ICONS["act-refuse"] = ground(24, 42.6, 15, 2.1) +
    `<circle cx="24" cy="23" r="16" fill="url(#i3-warn)"/><circle cx="24" cy="23" r="16" fill="url(#i3-shadeR)"/><circle cx="24" cy="23" r="16" fill="url(#i3-shadeB)"/>` +
    `<circle cx="24" cy="23" r="16" fill="none" stroke="#7d1810" stroke-width="1"/><circle cx="24" cy="23" r="13.6" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width=".8"/>` +
    `<ellipse cx="19.4" cy="13.6" rx="7.6" ry="3.4" fill="url(#i3-shine)" opacity=".55"/>` +
    `<rect x="13.4" y="20" width="21.2" height="6" rx="3" fill="#fff"/><path d="M15 25.4h18" stroke="#0a141c" stroke-opacity=".12" stroke-width=".8" stroke-linecap="round"/>`;
  // État vide de « À valider » : bac à courrier vide, coche verte en volume.
  ICONS["empty-inbox"] = ground(24, 42.4, 19, 2.2) +
    solid("M5.5 27.5l5.2-13.8a2.4 2.4 0 0 1 2.2-1.6h22.2a2.4 2.4 0 0 1 2.2 1.6l5.2 13.8V36a3 3 0 0 1-3 3H8.5a3 3 0 0 1-3-3Z") +
    `<path d="M9.4 27.5l4.4-11.6h20.4l4.4 11.6Z" fill="#c9d4dc"/><path d="M9.4 27.5l4.4-11.6h20.4" fill="none" stroke="#9aa8b3" stroke-width=".7"/>` +
    `<path d="M5.5 27.5h10.2l2.2 4.3h12.2l2.2-4.3h10.2" fill="none" ${S}/><path d="M7.2 29h7.6" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".9"/>` +
    `<circle cx="35" cy="12.6" r="8.6" fill="url(#i3-spg)" ${S}/><ellipse cx="32.8" cy="8.8" rx="4.8" ry="2.4" fill="url(#i3-shine)" opacity=".6"/>` +
    `<path d="M31 12.8l2.8 2.8 5.2-5.6" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`;
  // Résumé de « À valider » : le même bac, avec une demande (feuille) qui attend dedans.
  ICONS["ask-inbox"] = ground(24, 42.4, 19, 2.2) +
    solid("M5.5 27.5l5.2-13.8a2.4 2.4 0 0 1 2.2-1.6h22.2a2.4 2.4 0 0 1 2.2 1.6l5.2 13.8V36a3 3 0 0 1-3 3H8.5a3 3 0 0 1-3-3Z") +
    `<path d="M9.4 27.5l4.4-11.6h20.4l4.4 11.6Z" fill="#c9d4dc"/>` +
    `<path d="M14.6 5.6h18.8a1.6 1.6 0 0 1 1.6 1.6V30H13V7.2a1.6 1.6 0 0 1 1.6-1.6Z" fill="#fff" ${S}/>` +
    `<path d="M16.6 10.2h9.6" stroke="#0f6f8f" stroke-width="2.2" stroke-linecap="round"/>` +
    `<g stroke="#c3ced6" stroke-width="1.6" stroke-linecap="round"><path d="M16.6 14.8h14.8"/><path d="M16.6 18.8h14.8"/><path d="M16.6 22.8h9.8"/></g>` +
    solid("M5.5 27.5h10.2l2.2 4.3h12.2l2.2-4.3h10.2V36a3 3 0 0 1-3 3H8.5a3 3 0 0 1-3-3Z") +
    `<path d="M7.2 29h7.6" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".9"/>`;
  // Retours de l'équipe : passage fait (pastille verte), pris en charge (pastille bleue City-Drop), « fait » annulé (pastille orange, flèche retour).
  const badge = (grad, inner) => ground(24, 42.6, 15, 2.1) +
    `<circle cx="24" cy="23" r="16" fill="url(#i3-${grad})" ${S}/><circle cx="24" cy="23" r="16" fill="url(#i3-shadeR)"/><circle cx="24" cy="23" r="16" fill="url(#i3-shadeB)"/>` +
    `<ellipse cx="20" cy="13.4" rx="8" ry="3.6" fill="url(#i3-shine)" opacity=".6"/>` + inner;
  const TICK = `<path d="M16.6 23.4l5 5 9.6-10.2" fill="none" stroke="#0a141c" stroke-opacity=".18" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 1)"/><path d="M16.6 23.4l5 5 9.6-10.2" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  ICONS["ret-fait"] = badge("spg", TICK);
  ICONS["ret-confirme"] = badge("grip", TICK);
  ICONS["ret-erreur"] = badge("ora",
    `<path d="M30.4 30.2a9 9 0 1 0-12.6-.6" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/><path d="M13.4 25.8l4.6 5.2 5-4.6" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`);
  let ready = false;
  const ensureDefs = () => { if (!ready && typeof document !== "undefined" && document.body) { document.body.insertAdjacentHTML("afterbegin", DEFS); ready = true; } };
  const art = (q, cls = "issue-art") => { ensureDefs(); return ICONS[q] ? `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${ICONS[q]}</svg>` : ""; };
  root.IssueArt = { art, has: (q) => !!ICONS[q], DEFS, ICONS };
})(typeof self !== "undefined" ? self : this);
