<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Masuk Admin · Research Lab</title>
<style>:root{--bg:#f6f4ef;--surface:#fff;--ink:#1f2328;--line:#e3ded3;--accent:#1e5bd6;--err:#b42318}@media (prefers-color-scheme: dark){:root{--bg:#16181b;--surface:#1f2226;--ink:#eceae5;--line:#33373d;--accent:#7aa5ff;--err:#ff8a7a}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif;padding:16px}form{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:24px;width:min(380px,100%);display:grid;gap:12px}
input,button{font:inherit;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink)}button{background:var(--accent);color:#fff;border-color:var(--accent);cursor:pointer}label{display:grid;gap:4px}.err{color:var(--err)}</style></head>
<body><form method="post" action="/admin/login"><?= csrf_field() ?><h1 style="margin:0;font-size:22px">Admin Research Lab</h1>
<?php if ($error): ?><p class="err"><?= esc($error) ?></p><?php endif ?>
<label>Username<input name="username" autocomplete="username" required></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required></label>
<button>Masuk</button><a href="/">Ke aplikasi</a></form></body></html>
