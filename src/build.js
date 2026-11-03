// Builds two pages from the same sources:
//  - ../index.html          : the page served by GitHub Pages, backed by Firebase
//  - ../artifact.html       : the claude.ai artifact variant (not committed)
const fs = require("fs");
const read = (f) => fs.readFileSync(__dirname + "/" + f, "utf8");
const sheet = read("sheet-script.txt").replace("const SCRIPT = `", "const SHEET_SCRIPT = `");
const app = read("app.js").replace("/*@SHEET_SCRIPT*/", sheet.trim());
const inline = (code) => `<script>\n${code}</script>`;
const appScripts = ["domain.js", "store.js"].map((f) => inline(read(f))).join("\n") + "\n" + inline(app) + "\n";
const body = (scripts) => read("page.html").replace("<!--@style-->", read("style.css").trim()).replace("<!--@scripts-->", () => scripts);

const artifact = body(appScripts);
fs.writeFileSync(__dirname + "/../artifact.html", artifact);

const FIREBASE = "https://www.gstatic.com/firebasejs/10.12.2";
const siteScripts = ["firebase-app-compat", "firebase-auth-compat", "firebase-firestore-compat"]
  .map((f) => `<script src="${FIREBASE}/${f}.js"></script>`).join("\n")
  + `\n<script src="firebase-config.js"></script>\n` + inline(read("firebase-platform.js")) + "\n" + appScripts;
const site = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${body(siteScripts).replace(/^\s*<title>/, "<title>")}`.replace("<style>", "<style>\n[hidden]{display:none!important}\n#login{position:fixed;inset:0;display:grid;place-items:center;background:var(--bg);z-index:100;padding:16px}\n.login-card{width:min(380px,100%);display:grid;gap:14px}\n.login-error{color:var(--danger);font-size:13px}\n");
fs.writeFileSync(__dirname + "/../index.html", site.replace(/<\/style>/, "</style>\n</head>\n<body>") + "\n</body>\n</html>\n");
fs.copyFileSync(__dirname + "/firebase-config.js", __dirname + "/../firebase-config.js");
console.log("built artifact", artifact.length, "chars, site", site.length, "chars");
