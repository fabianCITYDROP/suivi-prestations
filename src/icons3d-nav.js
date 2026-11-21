// Icônes en volume de la navigation de l'équipe (menu « Plus ») et de l'écran de connexion (21/11/2026).
// Même famille que icons3d.js : une lumière en haut à gauche, dégradés partagés (#i3-…), contour fin, ombre au sol.
(function (root) {
  const A = root.IssueArt;
  if (!A) return;
  const O = "#24333e";
  const S = `stroke="${O}" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"`;
  const ground = (cx, cy, rx, ry = 2.2) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#i3-ground)"/>`;
  const solid = (d, fill = "body") => `<path d="${d}" fill="url(#i3-${fill})"/><path d="${d}" fill="url(#i3-shadeR)"/><path d="${d}" fill="url(#i3-shadeB)"/><path d="${d}" fill="none" ${S}/>`;
  const shine = (x, y, rx, ry, o = ".6") => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#i3-shine)" opacity="${o}"/>`;
  const I = A.ICONS;

  // Contrôles hayon : le même camion à hayon que dans les demandes.
  if (I["svc-hayon"]) I["nav-hayon"] = I["svc-hayon"];

  // Bilan du mois : socle blanc et trois barres bleu City-Drop.
  I["nav-bilan"] = ground(24, 42.6, 18, 2.1) +
    solid("M6 34.5h36a2 2 0 0 1 2 2v1.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5a2 2 0 0 1 2-2Z") +
    [[9, 23, 11.5], [19.5, 14, 20.5], [30, 7, 27.5]].map(([x, y, h]) =>
      solid(`M${x + 1.8} ${y}h5.4a1.8 1.8 0 0 1 1.8 1.8V${y + h}h-9V${y + 1.8}a1.8 1.8 0 0 1 1.8-1.8Z`, "grip") +
      `<path d="M${x + 1.6} ${y + 1.2}h5.8" stroke="#fff" stroke-opacity=".55" stroke-width=".9" stroke-linecap="round"/>`).join("") +
    `<path d="M6 35.6h35.6" stroke="#fff" stroke-width=".8" stroke-linecap="round"/>`;

  // Vérification : une feuille de lignes et une loupe posée dessus.
  I["nav-verif"] = ground(24, 43, 17, 2.1) +
    solid("M10.5 5.5h20.5l6.5 6.5v26a2 2 0 0 1-2 2h-25a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2Z") +
    `<path d="M31 5.5V12h6.5" fill="#d3dbe1" ${S}/>` +
    `<g stroke="#c3ced6" stroke-width="2" stroke-linecap="round"><path d="M14 15h12"/><path d="M14 20h16"/><path d="M14 25h9"/></g>` +
    `<path d="M33.2 33.4l7.2 7.2" stroke="${O}" stroke-width="5.4" stroke-linecap="round"/><path d="M33.2 33.4l7.2 7.2" stroke="url(#i3-dark)" stroke-width="4" stroke-linecap="round"/>` +
    `<circle cx="28" cy="28.2" r="8.4" fill="url(#i3-steel)" ${S}/><circle cx="28" cy="28.2" r="6.3" fill="url(#i3-mglass)" ${S}/>` +
    `<path d="M24.6 26.2a4 4 0 0 1 3-2.6" stroke="#fff" stroke-width="1.4" stroke-linecap="round" fill="none" opacity=".9"/>`;

  // Photos des modèles : un tirage photo (ciel, colline verte, soleil).
  I["nav-photos"] = ground(24, 42.4, 18, 2.1) +
    `<g transform="rotate(-6 24 24)">` + solid("M6.5 9.5h35a2 2 0 0 1 2 2v25a2 2 0 0 1-2 2h-35a2 2 0 0 1-2-2v-25a2 2 0 0 1 2-2Z") +
    `<rect x="8.5" y="13" width="31" height="21.5" rx="1.2" fill="url(#i3-mglass)" stroke="#7d8a95" stroke-width=".6"/>` +
    `<path d="M8.5 34.5V29l8-7.5 7.5 6.8 5-4.3 10.5 9v1.5Z" fill="url(#i3-spg)" stroke="#156334" stroke-width=".6" stroke-linejoin="round"/>` +
    `<circle cx="31.5" cy="18.6" r="3.2" fill="url(#i3-spy)" stroke="#b47300" stroke-width=".6"/>` +
    `<path d="M7.8 10.7h32.4" stroke="#fff" stroke-width=".8" stroke-linecap="round"/></g>`;

  // Corbeille : poubelle en acier, couvercle et poignée.
  I["nav-corbeille"] = ground(24, 43, 13.5, 2) +
    solid("M12.5 14.5h23l-2 24.5a2.4 2.4 0 0 1-2.4 2.2H16.9a2.4 2.4 0 0 1-2.4-2.2Z", "steel") +
    `<g stroke="#8a97a2" stroke-width="1.2" stroke-linecap="round"><path d="M19 19.5l.6 16.5"/><path d="M24 19.5v16.5"/><path d="M29 19.5l-.6 16.5"/></g>` +
    `<g stroke="#fff" stroke-width=".6" stroke-linecap="round" opacity=".8"><path d="M19.8 19.5l.6 16.5"/><path d="M24.8 19.5v16.5"/><path d="M29.8 19.5l-.6 16.5"/></g>` +
    `<path d="M19.5 9.5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v1.6h-2.2V9.8h-4.6v1.3h-2.2Z" fill="url(#i3-dark)" ${S}/>` +
    solid("M10 11h28a1.6 1.6 0 0 1 1.6 1.6v1.4a1.6 1.6 0 0 1-1.6 1.6H10A1.6 1.6 0 0 1 8.4 14v-1.4A1.6 1.6 0 0 1 10 11Z", "steel") +
    `<path d="M10.4 11.8h27" stroke="#fff" stroke-width=".8" stroke-linecap="round"/>`;

  // Réglages : roue dentée en acier, moyeu sombre.
  const gear = (() => {
    const cx = 24, cy = 23, R = 16.5, r = 12.8, n = 8, pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, w = Math.PI / n * 0.52, tw = Math.PI / n * 0.36;
      [[a - w, r], [a - tw, R], [a + tw, R], [a + w, r]].forEach(([t, rad]) => pts.push(`${(cx + rad * Math.cos(t)).toFixed(2)} ${(cy + rad * Math.sin(t)).toFixed(2)}`));
    }
    return "M" + pts.join("L") + "Z";
  })();
  I["nav-reglages"] = ground(24, 42.6, 15, 2.1) + solid(gear, "steel") +
    `<circle cx="24" cy="23" r="10.4" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".8"/>` +
    `<circle cx="24" cy="23" r="5.6" fill="url(#i3-dark)" ${S}/>` + `<path d="M20.6 21.4a3.6 3.6 0 0 1 2.4-2.2" stroke="#fff" stroke-opacity=".45" stroke-width=".9" stroke-linecap="round" fill="none"/>` +
    shine(19, 11.6, 6.4, 2.6, ".55");

  // Connexion : enveloppe (« Mot de passe oublié ») et cadenas (se connecter).
  I["login-mail"] = ground(24, 42, 19, 2.1) +
    solid("M6.5 12h35a2.5 2.5 0 0 1 2.5 2.5v21a2.5 2.5 0 0 1-2.5 2.5h-35A2.5 2.5 0 0 1 4 35.5v-21A2.5 2.5 0 0 1 6.5 12Z") +
    `<path d="M5 36.6l14.6-12.2M43 36.6L28.4 24.4" stroke="#aebbc6" stroke-width="1" stroke-linecap="round"/>` +
    `<path d="M4.6 13.4L24 28.6l19.4-15.2" fill="url(#i3-cab)" ${S}/>` +
    `<circle cx="24" cy="27" r="4.4" fill="url(#i3-grip)" ${S}/><path d="M22.2 25.6a2 2 0 0 1 1.6-1" stroke="#fff" stroke-opacity=".6" stroke-width=".8" stroke-linecap="round" fill="none"/>` +
    `<path d="M7 13.2h34" stroke="#fff" stroke-width=".8" stroke-linecap="round"/>`;
})(typeof self !== "undefined" ? self : this);
