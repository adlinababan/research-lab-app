<div class="card"><?php if (! $rows): ?><p class="muted">Belum ada proyek.</p><?php else: ?>
<table><tr><th>ID</th><th>Judul</th><th>Pemilik</th><th>Anggota</th><th>Langkah</th><th>Versi</th><th>Kunci rencana</th><th>Diperbarui (UTC)</th></tr>
<?php foreach ($rows as $r): ?><tr><td><?= (int) $r['id'] ?></td><td><?= esc($r['title'] ?: '(tanpa judul)') ?></td><td><?= esc($r['owner']) ?></td><td><?= (int) $r['members'] ?></td><td><?= (int) $r['step'] + 1 ?></td><td><?= (int) $r['version'] ?></td><td><?= (int) $r['locks'] ?></td><td class="muted"><?= esc($r['updated_at']) ?></td></tr><?php endforeach ?>
</table><?php endif ?><p class="muted">Isi proyek hanya dapat dibuka oleh anggotanya di aplikasi.</p></div>
