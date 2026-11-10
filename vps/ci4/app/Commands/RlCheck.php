<?php

namespace App\Commands;

use App\Libraries\Rl;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/** php spark rl:check — memeriksa konfigurasi, database, tabel, dan layanan Node setelah pemasangan. */
class RlCheck extends BaseCommand
{
    protected $group = 'Research Lab';
    protected $name = 'rl:check';
    protected $description = 'Memeriksa database, tabel, admin, token internal, dan layanan Node.';

    public function run(array $params)
    {
        $ok = true;
        $line = static function (bool $pass, string $text) use (&$ok) {
            $ok = $ok && $pass;
            CLI::write(($pass ? '[OK]   ' : '[GAGAL] ') . $text, $pass ? 'green' : 'red');
        };
        try {
            $db = Rl::db();
            $db->initialize();
            $line(true, 'Terhubung ke database ' . $db->getDatabase() . ' (' . $db->getPlatform() . ' ' . $db->getVersion() . ')');
            foreach (['users', 'projects', 'project_members', 'project_versions', 'plan_locks', 'project_files', 'ai_logs', 'login_attempts'] as $t) {
                $line($db->tableExists($t), "Tabel {$t}");
            }
            $admins = $db->tableExists('users') ? $db->table('users')->where(['role' => 'admin', 'active' => 1])->countAllResults() : 0;
            $line($admins > 0, "Akun admin aktif: {$admins}" . ($admins ? '' : ' (buat dengan: php spark rl:admin <username>)'));
            // Uji tulis/baca JSON besar (LONGTEXT) di tabel projects.
            $big = json_encode(['uji' => str_repeat('x', 300000)]);
            $db->table('projects')->insert(['owner_id' => 0, 'title' => '__rl_check__', 'data' => $big, 'version' => 1, 'created_at' => Rl::now(), 'updated_at' => Rl::now()]);
            $id = $db->insertID();
            $back = $db->table('projects')->select('data')->where('id', $id)->get()->getRow()->data ?? '';
            $db->table('projects')->where('id', $id)->delete();
            $line(strlen($back) === strlen($big), 'Simpan dan baca data proyek 300 KB');
        } catch (\Throwable $e) {
            $line(false, 'Database: ' . $e->getMessage());
        }
        $token = Rl::env('RL_INTERNAL_TOKEN');
        $line(strlen($token) >= 32, 'RL_INTERNAL_TOKEN diisi (minimal 32 karakter)');
        $url = rtrim(Rl::env('RL_NODE_URL', 'http://127.0.0.1:3311'), '/');
        $ch = curl_init($url . '/api/config');
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5]);
        $res = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        $line($code === 200, "Layanan Node {$url} menjawab /api/config" . ($code === 200 ? '' : ' (cek: systemctl status research-lab-node)'));
        $ch = curl_init($url . '/api/search');
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5, CURLOPT_POST => true, CURLOPT_POSTFIELDS => '{}', CURLOPT_HTTPHEADER => ['Content-Type: application/json']]);
        curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        $line($code === 401, 'Layanan Node menolak permintaan tanpa token internal' . ($code === 401 ? '' : " (status {$code}; pastikan INTERNAL_TOKEN di layanan Node sama dengan RL_INTERNAL_TOKEN)"));
        CLI::newLine();
        CLI::write($ok ? 'Semua pemeriksaan lolos.' : 'Ada pemeriksaan yang gagal. Perbaiki lalu jalankan ulang.', $ok ? 'green' : 'red');

        return $ok ? EXIT_SUCCESS : EXIT_ERROR;
    }
}
