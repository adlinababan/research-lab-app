<?php

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use App\Libraries\Rl;

/**
 * Login berbasis sesi. Bentuk jawaban sama dengan versi Vercel ({token, user, exp}) agar tampilan web
 * tidak perlu diubah; "token" hanya penanda, yang dipakai sebenarnya adalah cookie sesi.
 */
class Auth extends BaseController
{
    private const MAX_FAIL_IP = 12;   // per 15 menit per IP
    private const MAX_FAIL_USER = 8;  // per 15 menit per username
    private const DUMMY_HASH = '$2y$10$Hx2ZWmyyDFCztNajuycKLOkSAeJluZHhKNaHCQId5n5UnmdYFvOiy';

    public function login()
    {
        $b = $this->request->getJSON(true) ?? [];
        $username = strtolower(trim((string) ($b['username'] ?? '')));
        $password = (string) ($b['password'] ?? '');
        $db = Rl::db();
        $since = gmdate('Y-m-d H:i:s', time() - 900);
        $ipFails = $db->table('login_attempts')->where(['ip' => Rl::ip(), 'success' => 0, 'created_at >=' => $since])->countAllResults();
        $userFails = $username === '' ? 0 : $db->table('login_attempts')->where(['username' => $username, 'success' => 0, 'created_at >=' => $since])->countAllResults();
        if ($ipFails >= self::MAX_FAIL_IP || $userFails >= self::MAX_FAIL_USER) {
            return $this->response->setStatusCode(429)->setJSON(['error' => 'Terlalu banyak percobaan masuk yang gagal. Coba lagi 15 menit lagi atau hubungi admin.', 'code' => 'rate']);
        }
        $u = $username === '' ? null : $db->table('users')->where('username', $username)->get()->getRow();
        // password_verify tetap dijalankan walau akun tidak ada, agar waktu respons tidak membocorkan nama akun.
        $ok = password_verify($password, $u->password_hash ?? self::DUMMY_HASH) && $u && (int) $u->active === 1;
        $db->table('login_attempts')->insert(['ip' => Rl::ip(), 'username' => substr($username, 0, 60), 'success' => $ok ? 1 : 0, 'created_at' => Rl::now()]);
        if (! $ok) {
            usleep(400000);

            return $this->response->setStatusCode(401)->setJSON(['error' => 'Username atau password salah.', 'code' => 'login']);
        }
        if (password_needs_rehash($u->password_hash, PASSWORD_DEFAULT)) {
            $db->table('users')->where('id', $u->id)->update(['password_hash' => password_hash($password, PASSWORD_DEFAULT)]);
        }
        session()->regenerate(true);
        session()->set(['uid' => (int) $u->id, 'role' => $u->role]);
        $db->table('users')->where('id', $u->id)->update(['last_login_at' => Rl::now()]);
        $exp = (time() + (int) config('Session')->expiration) * 1000;

        return $this->response->setJSON(['token' => 'session', 'user' => $u->username, 'name' => $u->name, 'role' => $u->role, 'exp' => $exp]);
    }

    /** GET /api/login: cek sesi (dipakai tampilan web saat dibuka ulang). */
    public function me()
    {
        $uid = Rl::uid();
        $u = $uid ? Rl::db()->table('users')->where('id', $uid)->get()->getRow() : null;
        if (! $u || (int) $u->active !== 1) {
            return $this->response->setStatusCode(401)->setJSON(['error' => 'Sesi login berakhir. Silakan masuk lagi.', 'code' => 'login']);
        }

        return $this->response->setJSON(['user' => $u->username, 'name' => $u->name, 'role' => $u->role]);
    }

    public function logout()
    {
        session()->destroy();

        return $this->response->setJSON(['ok' => true]);
    }

    /** Ganti password sendiri. */
    public function password()
    {
        $b = $this->request->getJSON(true) ?? [];
        $u = Rl::db()->table('users')->where('id', Rl::uid())->get()->getRow();
        if (! $u || ! password_verify((string) ($b['old'] ?? ''), $u->password_hash)) {
            return $this->response->setStatusCode(400)->setJSON(['error' => 'Password lama salah.']);
        }
        $new = (string) ($b['new'] ?? '');
        if (strlen($new) < 10) {
            return $this->response->setStatusCode(400)->setJSON(['error' => 'Password baru minimal 10 karakter.']);
        }
        Rl::db()->table('users')->where('id', $u->id)->update(['password_hash' => password_hash($new, PASSWORD_DEFAULT), 'updated_at' => Rl::now()]);

        return $this->response->setJSON(['ok' => true]);
    }
}
