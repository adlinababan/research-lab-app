<?php

namespace App\Libraries;

use CodeIgniter\Database\BaseConnection;

/** Helper bersama: waktu UTC, akses proyek, IP klien. */
class Rl
{
    public static function db(): BaseConnection
    {
        return db_connect();
    }

    /** Waktu sekarang (UTC) untuk kolom DATETIME. */
    public static function now(): string
    {
        return gmdate('Y-m-d H:i:s');
    }

    /** DATETIME (UTC) -> ISO 8601 untuk browser. */
    public static function iso(?string $dt): ?string
    {
        return $dt ? str_replace(' ', 'T', $dt) . 'Z' : null;
    }

    public static function uid(): int
    {
        return (int) (session('uid') ?? 0);
    }

    /** Peran pengguna pada proyek: owner | editor | viewer, atau null bila bukan anggota. */
    public static function projectRole(int $projectId, int $userId): ?string
    {
        $p = self::db()->table('projects')->select('id')->where(['id' => $projectId, 'deleted_at' => null])->get()->getRow();
        if (! $p) {
            return null;
        }
        $m = self::db()->table('project_members')->where(['project_id' => $projectId, 'user_id' => $userId])->get()->getRow();

        return $m->role ?? null;
    }

    public static function ip(): string
    {
        return substr((string) service('request')->getIPAddress(), 0, 45);
    }

    public static function env(string $key, string $default = ''): string
    {
        $v = getenv($key);

        return $v === false || $v === '' ? $default : (string) $v;
    }
}
