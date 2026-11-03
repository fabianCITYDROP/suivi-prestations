// Builds two pages from the same sources:
//  - ../index.html          : the page served by GitHub Pages, backed by Firebase
//  - ../artifact.html       : the claude.ai artifact variant (not committed)
const fs = require("fs");
const read = (f) => fs.readFileSync(__dirname + "/" + f, "utf8");
const sheet = read("sheet-script.txt").replace("const SCRIPT = `", "const SHEET_SCRIPT = `");
const app = read("app.js").replace("/*@SHEET_SCRIPT*/", sheet.trim());
const inline = (code) => `<script>\n${code}</script>`;
const appScripts = ["domain.js", "store.js", "presta.js"].map((f) => inline(read(f))).join("\n") + "\n" + inline(app) + "\n";
const body = (scripts) => read("page.html").replace("<!--@style-->", read("style.css").trim()).replace("<!--@scripts-->", () => scripts);

const artifact = body(appScripts);
fs.writeFileSync(__dirname + "/../artifact.html", artifact);

const FIREBASE = "https://www.gstatic.com/firebasejs/10.12.2";
const siteScripts = ["firebase-app-compat", "firebase-auth-compat", "firebase-firestore-compat"]
  .map((f) => `<script src="${FIREBASE}/${f}.js"></script>`).join("\n")
  + "\n" + inline(read("firebase-config.js")) + "\n" + inline(read("firebase-platform.js")) + "\n" + appScripts;
const site = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">\n<link rel="icon" href="assets/logo.svg" type="image/svg+xml">\n<link rel="icon" href="assets/icon-32.png" sizes="32x32">\n<link rel="apple-touch-icon" href="assets/icon-180.png">\n<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="#0f6f8f">\n<meta name="apple-mobile-web-app-title" content="Presta">
${body(siteScripts).replace(/^\s*<title>/, "<title>")}`.replace("<style>", "<style>\n[hidden]{display:none!important}\n#login{position:fixed;inset:0;display:grid;place-items:center;background:var(--bg);z-index:100;padding:16px}\n.login-card{width:min(380px,100%);display:grid;gap:14px}\n.login-error{color:var(--danger);font-size:13px}\n.account{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px;font-size:14px;color:var(--ink-2)}\n");
fs.writeFileSync(__dirname + "/../index.html", site.replace(/<\/style>/, "</style>\n</head>\n<body>") + "\n</body>\n</html>\n");
console.log("built artifact", artifact.length, "chars, site", site.length, "chars");
