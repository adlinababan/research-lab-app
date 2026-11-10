<div class="stats">
  <div class="stat"><b><?= (int) $stats['users'] ?></b>akun aktif</div>
  <div class="stat"><b><?= (int) $stats['projects'] ?></b>proyek</div>
  <div class="stat"><b><?= (int) $stats['ai_week'] ?></b>panggilan AI (7 hari)</div>
  <div class="stat"><b><?= (int) $stats['err_week'] ?></b>panggilan gagal (7 hari)</div>
  <div class="stat"><b><?= (int) $stats['logins'] ?></b>login berhasil (7 hari)</div>
</div>
<div class="card" style="margin-top:16px"><h2 style="margin-top:0;font-size:18px">Pengguna paling aktif (7 hari)</h2>
<?php if (! $top): ?><p class="muted">Belum ada pemakaian.</p><?php else: ?>
<table><tr><th>Username</th><th>Permintaan</th></tr><?php foreach ($top as $t): ?><tr><td><?= esc($t['username']) ?></td><td><?= (int) $t['n'] ?></td></tr><?php endforeach ?></table><?php endif ?></div>
