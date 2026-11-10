<div class="card"><h2 style="margin-top:0;font-size:18px">Per jenis permintaan</h2><?php if (! $rows): ?><p class="muted">Belum ada pemakaian.</p><?php else: ?>
<table><tr><th>Layanan</th><th>Tugas</th><th>Jumlah</th><th>Rata-rata durasi</th><th>Gagal</th></tr>
<?php foreach ($rows as $r): ?><tr><td><?= esc($r['endpoint']) ?></td><td><?= esc($r['task'] ?: '-') ?></td><td><?= (int) $r['n'] ?></td><td><?= number_format(((int) $r['avg_ms']) / 1000, 1, ',', '.') ?> dtk</td><td><?= (int) $r['errors'] ?></td></tr><?php endforeach ?>
</table><?php endif ?></div>
<div class="card"><h2 style="margin-top:0;font-size:18px">Per model AI</h2><?php if (! $models): ?><p class="muted">Belum ada.</p><?php else: ?>
<table><tr><th>Model</th><th>Jumlah</th></tr><?php foreach ($models as $m): ?><tr><td><?= esc($m['model']) ?></td><td><?= (int) $m['n'] ?></td></tr><?php endforeach ?></table><?php endif ?></div>
