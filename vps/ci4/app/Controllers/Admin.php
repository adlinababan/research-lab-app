<?php

namespace App\Controllers;

use App\Libraries\Rl;

/** Panel admin: akun, proyek, dan pemakaian AI. Formulir dilindungi CSRF. */
class Admin extends BaseController
{
    protected $helpers = ['form', 'url'];

    private function view(string $name, array $data = []): string
    {
        $me = Rl::uid() ? Rl::db()->table('users')->where('id', Rl::uid())->get()->getRow() : null;

        return view('admin/layout', ['content' => view('admin/' . $name, $data), 'me' => $me, 'title' => $data['title'] ?? 'Admin']);
    }

    public function loginForm()
    {
        return view('admin/login', ['error' => session()->getFlashdata('error')]);
    }

    public function login()
    {
        $username = strtolower(trim((string) $this->request->getPost('username')));
        $since = gmdate('Y-m-d H:i:s', time() - 900);
        $db = Rl::db();
        if ($db->table('login_attempts')->where(['ip' => Rl::ip(), 'success' => 0, 'created_at >=' => $since])->countAllResults() >= 12) {
            return redirect()->to('/admin/login')->with('error', 'Terlalu banyak percobaan gagal. Coba lagi 15 menit lagi.');
        }
        $u = $db->table('users')->where('username', $username)->get()->getRow();
        $ok = $u && (int) $u->active === 1 && password_verify((string) $this->request->getPost('password'), $u->password_hash);
        $db->table('login_attempts')->insert(['ip' => Rl::ip(), 'username' => substr($username, 0, 60), 'success' => $ok ? 1 : 0, 'created_at' => Rl::now()]);
        if (! $ok) {
            return redirect()->to('/admin/login')->with('error', 'Username atau password salah.');
        }
        session()->regenerate(true);
        session()->set(['uid' => (int) $u->id, 'role' => $u->role]);
        $db->table('users')->where('id', $u->id)->update(['last_login_at' => Rl::now()]);

        return redirect()->to($u->role === 'admin' ? '/admin' : '/');
    }

    public function logout()
    {
        session()->destroy();

        return redirect()->to('/admin/login');
    }

    public function index()
    {
        $db = Rl::db();
        $week = gmdate('Y-m-d H:i:s', time() - 7 * 86400);
        $stats = [
            'users'    => $db->table('users')->where('active', 1)->countAllResults(),
            'projects' => $db->table('projects')->where('deleted_at', null)->countAllResults(),
            'ai_week'  => $db->table('ai_logs')->where(['endpoint' => 'llm', 'created_at >=' => $week])->countAllResults(),
            'err_week' => $db->table('ai_logs')->where(['created_at >=' => $week, 'status >=' => 400])->countAllResults(),
            'logins'   => $db->table('login_attempts')->where(['created_at >=' => $week, 'success' => 1])->countAllResults(),
        ];
        $top = $db->table('ai_logs a')->select('u.username, COUNT(*) AS n')->join('users u', 'u.id = a.user_id')->where('a.created_at >=', $week)
            ->groupBy('u.username')->orderBy('n', 'DESC')->limit(10)->get()->getResultArray();

        return $this->view('dashboard', ['title' => 'Ringkasan', 'stats' => $stats, 'top' => $top]);
    }

    public function users()
    {
        $rows = Rl::db()->table('users u')->select('u.*, (SELECT COUNT(*) FROM project_members m WHERE m.user_id = u.id) AS projects')->orderBy('u.username')->get()->getResultArray();

        return $this->view('users', ['title' => 'Akun', 'rows' => $rows, 'msg' => session()->getFlashdata('msg'), 'error' => session()->getFlashdata('error')]);
    }

    public function createUser()
    {
        $username = strtolower(trim((string) $this->request->getPost('username')));
        $pass = (string) $this->request->getPost('password');
        if (! preg_match('/^[a-z0-9._@-]{2,60}$/', $username)) {
            return redirect()->to('/admin/users')->with('error', 'Username 2–60 karakter: huruf kecil, angka, titik, garis bawah, @, atau tanda hubung.');
        }
        if (strlen($pass) < 10) {
            return redirect()->to('/admin/users')->with('error', 'Password minimal 10 karakter.');
        }
        $db = Rl::db();
        if ($db->table('users')->where('username', $username)->countAllResults()) {
            return redirect()->to('/admin/users')->with('error', 'Username sudah dipakai.');
        }
        $db->table('users')->insert([
            'username' => $username, 'name' => mb_substr(trim((string) $this->request->getPost('name')), 0, 120),
            'email' => trim((string) $this->request->getPost('email')) ?: null,
            'password_hash' => password_hash($pass, PASSWORD_DEFAULT),
            'role' => $this->request->getPost('role') === 'admin' ? 'admin' : 'user', 'active' => 1,
            'created_at' => Rl::now(), 'updated_at' => Rl::now(),
        ]);

        return redirect()->to('/admin/users')->with('msg', "Akun {$username} dibuat.");
    }

    public function updateUser(int $id)
    {
        $db = Rl::db();
        $u = $db->table('users')->where('id', $id)->get()->getRow();
        if (! $u) {
            return redirect()->to('/admin/users')->with('error', 'Akun tidak ditemukan.');
        }
        $act = (string) $this->request->getPost('action');
        if ($id === Rl::uid() && in_array($act, ['deactivate', 'make_user'], true)) {
            return redirect()->to('/admin/users')->with('error', 'Anda tidak dapat menonaktifkan atau menurunkan peran akun sendiri.');
        }
        $upd = ['updated_at' => Rl::now()];
        $msg = '';
        switch ($act) {
            case 'deactivate': $upd['active'] = 0; $msg = 'dinonaktifkan'; break;
            case 'activate': $upd['active'] = 1; $msg = 'diaktifkan'; break;
            case 'make_admin': $upd['role'] = 'admin'; $msg = 'dijadikan admin'; break;
            case 'make_user': $upd['role'] = 'user'; $msg = 'dijadikan pengguna biasa'; break;
            case 'password':
                $pass = (string) $this->request->getPost('password');
                if (strlen($pass) < 10) {
                    return redirect()->to('/admin/users')->with('error', 'Password minimal 10 karakter.');
                }
                $upd['password_hash'] = password_hash($pass, PASSWORD_DEFAULT);
                $msg = 'password-nya diganti';
                break;
            default:
                return redirect()->to('/admin/users');
        }
        $db->table('users')->where('id', $id)->update($upd);

        return redirect()->to('/admin/users')->with('msg', "Akun {$u->username} {$msg}.");
    }

    public function projects()
    {
        $rows = Rl::db()->table('projects p')
            ->select('p.id, p.title, p.step, p.version, p.updated_at, p.created_at, u.username AS owner, (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS members, (SELECT COUNT(*) FROM plan_locks l WHERE l.project_id = p.id) AS locks')
            ->join('users u', 'u.id = p.owner_id')->where('p.deleted_at', null)->orderBy('p.updated_at', 'DESC')->get()->getResultArray();

        return $this->view('projects', ['title' => 'Proyek', 'rows' => $rows]);
    }

    public function usage()
    {
        $since = gmdate('Y-m-d H:i:s', time() - 30 * 86400);
        $rows = Rl::db()->table('ai_logs')->select('endpoint, task, COUNT(*) AS n, ROUND(AVG(duration_ms)) AS avg_ms, SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors')
            ->where('created_at >=', $since)->groupBy(['endpoint', 'task'])->orderBy('n', 'DESC')->get()->getResultArray();
        $models = Rl::db()->table('ai_logs')->select('model, COUNT(*) AS n')->where(['created_at >=' => $since, 'model !=' => ''])->groupBy('model')->orderBy('n', 'DESC')->get()->getResultArray();

        return $this->view('usage', ['title' => 'Pemakaian AI (30 hari)', 'rows' => $rows, 'models' => $models]);
    }
}
