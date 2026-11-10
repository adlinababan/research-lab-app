<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Skema Research Lab (MySQL 8 / MariaDB; juga jalan di SQLite untuk uji lokal).
 * Data sesi tiap proyek disimpan utuh sebagai JSON (kolom LONGTEXT) agar tampilan web tidak perlu diubah;
 * riwayat versi, kunci rencana, gambar hasil, log AI, dan percobaan login disimpan di tabel terpisah.
 */
class CreateResearchLabTables extends Migration
{
    public function up(): void
    {
        $id = ['type' => 'INT', 'constraint' => 10, 'unsigned' => true, 'auto_increment' => true];
        $fk = ['type' => 'INT', 'constraint' => 10, 'unsigned' => true];
        $ts = ['type' => 'DATETIME', 'null' => true];

        $this->forge->addField([
            'id'            => $id,
            'username'      => ['type' => 'VARCHAR', 'constraint' => 60],
            'name'          => ['type' => 'VARCHAR', 'constraint' => 120, 'default' => ''],
            'email'         => ['type' => 'VARCHAR', 'constraint' => 160, 'null' => true],
            'password_hash' => ['type' => 'VARCHAR', 'constraint' => 255],
            'role'          => ['type' => 'VARCHAR', 'constraint' => 10, 'default' => 'user'],
            'active'        => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'last_login_at' => $ts,
            'created_at'    => $ts,
            'updated_at'    => $ts,
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey('username');
        $this->forge->createTable('users', true);

        $this->forge->addField([
            'id'         => $id,
            'owner_id'   => $fk,
            'title'      => ['type' => 'VARCHAR', 'constraint' => 400, 'default' => ''],
            'step'       => ['type' => 'TINYINT', 'constraint' => 3, 'default' => 0],
            'data'       => ['type' => 'LONGTEXT', 'null' => true],
            'version'    => ['type' => 'INT', 'constraint' => 10, 'unsigned' => true, 'default' => 1],
            'updated_by' => ['type' => 'INT', 'constraint' => 10, 'unsigned' => true, 'null' => true],
            'created_at' => $ts,
            'updated_at' => $ts,
            'deleted_at' => $ts,
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('owner_id');
        $this->forge->createTable('projects', true);

        $this->forge->addField([
            'project_id' => $fk,
            'user_id'    => $fk,
            'role'       => ['type' => 'VARCHAR', 'constraint' => 10, 'default' => 'editor'],
            'created_at' => $ts,
        ]);
        $this->forge->addKey(['project_id', 'user_id'], true);
        $this->forge->addKey('user_id');
        $this->forge->createTable('project_members', true);

        $this->forge->addField([
            'id'         => $id,
            'project_id' => $fk,
            'user_id'    => $fk,
            'version'    => ['type' => 'INT', 'constraint' => 10, 'unsigned' => true],
            'data'       => ['type' => 'LONGTEXT', 'null' => true],
            'note'       => ['type' => 'VARCHAR', 'constraint' => 200, 'default' => ''],
            'created_at' => $ts,
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey(['project_id', 'created_at']);
        $this->forge->createTable('project_versions', true);

        $this->forge->addField([
            'id'         => $id,
            'project_id' => $fk,
            'user_id'    => $fk,
            'hash'       => ['type' => 'CHAR', 'constraint' => 64],
            'snapshot'   => ['type' => 'LONGTEXT', 'null' => true],
            'locked_at'  => $ts,
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('project_id');
        $this->forge->createTable('plan_locks', true);

        $this->forge->addField([
            'id'         => $id,
            'project_id' => $fk,
            'fkey'       => ['type' => 'VARCHAR', 'constraint' => 20],
            'mime'       => ['type' => 'VARCHAR', 'constraint' => 40, 'default' => ''],
            'data'       => ['type' => 'LONGTEXT', 'null' => true],
            'size'       => ['type' => 'INT', 'constraint' => 10, 'unsigned' => true, 'default' => 0],
            'created_at' => $ts,
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey(['project_id', 'fkey']);
        $this->forge->createTable('project_files', true);

        $this->forge->addField([
            'id'          => $id,
            'user_id'     => $fk,
            'project_id'  => ['type' => 'INT', 'constraint' => 10, 'unsigned' => true, 'null' => true],
            'endpoint'    => ['type' => 'VARCHAR', 'constraint' => 20],
            'task'        => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => ''],
            'model'       => ['type' => 'VARCHAR', 'constraint' => 80, 'default' => ''],
            'status'      => ['type' => 'SMALLINT', 'constraint' => 5, 'default' => 0],
            'duration_ms' => ['type' => 'INT', 'constraint' => 10, 'unsigned' => true, 'default' => 0],
            'created_at'  => $ts,
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey(['user_id', 'created_at']);
        $this->forge->createTable('ai_logs', true);

        $this->forge->addField([
            'id'         => $id,
            'ip'         => ['type' => 'VARCHAR', 'constraint' => 45],
            'username'   => ['type' => 'VARCHAR', 'constraint' => 60, 'default' => ''],
            'success'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'created_at' => $ts,
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey(['ip', 'created_at']);
        $this->forge->createTable('login_attempts', true);
    }

    public function down(): void
    {
        foreach (['login_attempts', 'ai_logs', 'project_files', 'plan_locks', 'project_versions', 'project_members', 'projects', 'users'] as $t) {
            $this->forge->dropTable($t, true);
        }
    }
}
