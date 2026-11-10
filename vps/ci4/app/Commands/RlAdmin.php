<?php

namespace App\Commands;

use App\Libraries\Rl;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/** php spark rl:admin <username> [password]  — buat atau perbarui akun admin. */
class RlAdmin extends BaseCommand
{
    protected $group = 'Research Lab';
    protected $name = 'rl:admin';
    protected $description = 'Membuat atau memperbarui akun admin (password diminta bila tidak diberikan).';
    protected $usage = 'rl:admin <username> [password]';

    public function run(array $params)
    {
        $username = strtolower(trim((string) ($params[0] ?? CLI::prompt('Username admin'))));
        if (! preg_match('/^[a-z0-9._@-]{2,60}$/', $username)) {
            CLI::error('Username 2–60 karakter: huruf kecil, angka, titik, garis bawah, @, atau tanda hubung.');

            return EXIT_ERROR;
        }
        $pass = (string) ($params[1] ?? CLI::prompt('Password (min. 10 karakter)'));
        if (strlen($pass) < 10) {
            CLI::error('Password minimal 10 karakter.');

            return EXIT_ERROR;
        }
        $db = Rl::db();
        $row = ['password_hash' => password_hash($pass, PASSWORD_DEFAULT), 'role' => 'admin', 'active' => 1, 'updated_at' => Rl::now()];
        if ($db->table('users')->where('username', $username)->countAllResults()) {
            $db->table('users')->where('username', $username)->update($row);
            CLI::write("Akun {$username} diperbarui sebagai admin.", 'green');
        } else {
            $db->table('users')->insert($row + ['username' => $username, 'name' => 'Admin', 'created_at' => Rl::now()]);
            CLI::write("Akun admin {$username} dibuat.", 'green');
        }

        return EXIT_SUCCESS;
    }
}
