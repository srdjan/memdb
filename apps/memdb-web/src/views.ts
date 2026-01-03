export const layout = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/static/app.css" />
</head>
<body>
  <header class="hdr">
    <div class="hdr__inner">
      <a href="/" class="brand">memdb-web</a>
      <nav class="nav">
        <a href="/" class="nav__a">Home</a>
      </nav>
    </div>
  </header>
  <main class="main">
    ${body}
  </main>
  <footer class="ftr">
    <div class="ftr__inner">placeholder UI for agent memory</div>
  </footer>
</body>
</html>`;

export const html = {
  home: (packs: readonly string[]): string => `
    <h1>Agent memory workspace</h1>
    <p>This is a placeholder UI. Pick a pack to browse entities.</p>
    <section class="card">
      <h2>Packs</h2>
      <ul>
        ${packs.map((p) => `<li><a href="/packs/${encodeURIComponent(p)}">${escapeHtml(p)}</a></li>`).join("")}
      </ul>
    </section>
  `,
  pack: (pack: string, entities: readonly { id: string; type: string; key: string }[]): string => `
    <h1>Pack: ${escapeHtml(pack)}</h1>
    <p>Entities known to this pack (best-effort). Click for JSON.</p>
    <section class="card">
      <table class="tbl">
        <thead><tr><th>id</th><th>type</th><th>key</th><th></th></tr></thead>
        <tbody>
          ${entities.map((e) => `
            <tr>
              <td><code>${escapeHtml(e.id)}</code></td>
              <td>${escapeHtml(e.type)}</td>
              <td><code>${escapeHtml(e.key)}</code></td>
              <td><a href="/api/entities/${encodeURIComponent(e.id)}">json</a></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </section>
  `,
};

const escapeHtml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
