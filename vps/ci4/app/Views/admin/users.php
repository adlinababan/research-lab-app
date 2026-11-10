<?php if ($msg): ?><div class="msg ok"><?= esc($msg) ?></div><?php endif ?>
<?php if ($error): ?><div class="msg err"><?= esc($error) ?></div><?php endif ?>
<div class="card"><h2 style="margin-top:0;font-size:18px">Tambah akun</h2>
<form method="post" action="/admin/users" class="row"><?= csrf_field() ?>
  <label>Username<input name="username" required pattern="[a-z0-9._@\-]{2,60}"></label>
  <label>Nama<input name="name"></label>
  <label>Email (opsional)<input name="email" type="email"></label>
  <label>Password (min. 10)<input name="password" type="text" required minlength="10"></label>
  <label>Peran<select name="role"><option value="user">Pengguna</option><option value="admin">Admin</option></select></label>
  <button class="primary">Tambah</button>
</form></div>
<div class="card"><table>
<tr><th>Username</th><th>Nama</th><th>Peran</th><th>Status</th><th>Proyek</th><th>Login terakhir (UTC)</th><th>Aksi</th></tr>
<?php foreach ($rows as $r): ?>
<tr><td><?= esc($r['username']) ?></td><td><?= esc($r['name']) ?><?= $r['email'] ? '<div class="muted">' . esc($r['email']) . '</div>' : '' ?></td>
<td><?= $r['role'] === 'admin' ? 'Admin' : 'Pengguna' ?></td><td><?= (int) $r['active'] ? 'Aktif' : '<span class="err">Nonaktif</span>' ?></td>
<td><?= (int) $r['projects'] ?></td><td class="muted"><?= esc($r['last_login_at'] ?? '-') ?></td>
<td>
  <form method="post" action="/admin/users/<?= (int) $r['id'] ?>" class="inline"><?= csrf_field() ?><input type="hidden" name="action" value="<?= (int) $r['active'] ? 'deactivate' : 'activate' ?>"><button><?= (int) $r['active'] ? 'Nonaktifkan' : 'Aktifkan' ?></button></form>
  <form method="post" action="/admin/users/<?= (int) $r['id'] ?>" class="inline"><?= csrf_field() ?><input type="hidden" name="action" value="<?= $r['role'] === 'admin' ? 'make_user' : 'make_admin' ?>"><button><?= $r['role'] === 'admin' ? 'Jadikan pengguna' : 'Jadikan admin' ?></button></form>
  <form method="post" action="/admin/users/<?= (int) $r['id'] ?>" class="inline"><?= csrf_field() ?><input type="hidden" name="action" value="password"><input name="password" placeholder="Password baru" minlength="10" required size="14"><button>Ganti</button></form>
</td></tr>
<?php endforeach ?>
</table></div>
