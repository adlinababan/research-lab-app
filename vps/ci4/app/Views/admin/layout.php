<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= esc($title) ?> · Admin Research Lab</title>
<style>
:root { --bg:#f6f4ef; --surface:#fff; --ink:#1f2328; --muted:#5d636b; --line:#e3ded3; --accent:#1e5bd6; --ok:#1c7a4a; --err:#b42318; }
@media (prefers-color-scheme: dark) { :root { --bg:#16181b; --surface:#1f2226; --ink:#eceae5; --muted:#a4a8ae; --line:#33373d; --accent:#7aa5ff; --ok:#5cc48c; --err:#ff8a7a; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { display:flex; flex-wrap:wrap; gap:16px; align-items:center; padding:12px 20px; background:var(--surface); border-bottom:1px solid var(--line); }
header b { font-size:18px; } nav a { color:var(--ink); text-decoration:none; padding:6px 10px; border-radius:8px; } nav a:hover { background:var(--bg); }
header .sp { flex:1; } main { max-width:1100px; margin:0 auto; padding:20px 16px 60px; }
h1 { font-size:24px; margin:4px 0 16px; } .card { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:16px; overflow-x:auto; }
table { border-collapse:collapse; width:100%; font-size:14.5px; } th, td { text-align:left; padding:8px; border-bottom:1px solid var(--line); vertical-align:top; } th { color:var(--muted); font-weight:600; }
input, select, button { font:inherit; padding:7px 10px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--ink); }
button { cursor:pointer; } button.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
.row { display:flex; flex-wrap:wrap; gap:8px; align-items:flex-end; } label { display:grid; gap:4px; font-size:14px; color:var(--muted); }
.msg { padding:10px 12px; border-radius:8px; margin-bottom:12px; } .ok { background:color-mix(in srgb, var(--ok) 14%, transparent); color:var(--ok); } .err { background:color-mix(in srgb, var(--err) 14%, transparent); color:var(--err); }
.stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; } .stat { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:14px; } .stat b { display:block; font-size:28px; }
.muted { color:var(--muted); font-size:13.5px; } form.inline { display:inline-flex; gap:4px; margin:2px 0; }
</style>
</head>
<body>
<header><b>Research Lab · Admin</b>
<nav><a href="/admin">Ringkasan</a><a href="/admin/users">Akun</a><a href="/admin/projects">Proyek</a><a href="/admin/usage">Pemakaian AI</a><a href="/">Buka aplikasi</a></nav>
<span class="sp"></span><span class="muted"><?= esc($me->username ?? '') ?></span>
<form method="post" action="/admin/logout" class="inline"><?= csrf_field() ?><button>Keluar</button></form></header>
<main><h1><?= esc($title) ?></h1><?= $content ?></main>
</body>
</html>
