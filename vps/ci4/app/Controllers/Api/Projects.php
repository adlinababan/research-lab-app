<?php

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use App\Libraries\Rl;

/**
 * Proyek penelitian per akun dan tim: simpan/muat (dengan deteksi konflik), riwayat versi,
 * kunci Rencana Hasil bertanda waktu server, anggota tim, dan gambar hasil.
 */
class Projects extends BaseController
{
    private const MAX_DATA = 8 * 1024 * 1024;      // JSON sesi
    private const MAX_FILES = 25 * 1024 * 1024;    // total gambar hasil per proyek
    private const SNAPSHOT_EVERY = 600;            // detik: simpan versi otomatis paling sering tiap 10 menit
    private const KEEP_VERSIONS = 200;

    private function err(int $code, string $msg)
    {
        return $this->response->setStatusCode($code)->setJSON(['error' => $msg]);
    }

    private function role(int $id): ?string
    {
        return Rl::projectRole($id, Rl::uid());
    }

    /**
     * Data sesi didekode sebagai objek (bukan array) agar objek kosong {} tetap {} saat disimpan ulang;
     * json_decode(..., true) mengubah {} menjadi [] dan merusak data di browser.
     */
    private function body(): object
    {
        $b = json_decode((string) $this->request->getBody());

        return is_object($b) ? $b : new \stdClass();
    }

    private function enc($data): string
    {
        return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    }

    private function titleOf($data): string
    {
        return mb_substr(trim((string) ($data->me->title ?? '')), 0, 400);
    }

    private function stepOf($data): int
    {
        return (int) ($data->step ?? 0);
    }

    /** Jawaban JSON yang menyisipkan data sesi mentah dari database tanpa dekode ulang. */
    private function withRawData(array $fields, ?string $rawData)
    {
        $raw = $rawData !== null && $rawData !== '' && is_object(json_decode($rawData)) ? $rawData : '{}';
        $json = substr($this->enc((object) $fields), 0, -1) . ',"data":' . $raw . '}';

        return $this->response->setContentType('application/json')->setBody($json);
    }

    private function snapshot(int $pid, int $version, string $json, string $note): void
    {
        $db = Rl::db();
        $db->table('project_versions')->insert(['project_id' => $pid, 'user_id' => Rl::uid(), 'version' => $version, 'data' => $json, 'note' => mb_substr($note, 0, 200), 'created_at' => Rl::now()]);
        $ids = $db->table('project_versions')->select('id')->where('project_id', $pid)->orderBy('id', 'DESC')->limit(1000, self::KEEP_VERSIONS)->get()->getResultArray();
        if ($ids) {
            $db->table('project_versions')->whereIn('id', array_column($ids, 'id'))->delete();
        }
    }

    public function index()
    {
        $rows = Rl::db()->table('project_members m')
            ->select('p.id, p.title, p.step, p.version, p.updated_at, m.role, u.username AS owner')
            ->join('projects p', 'p.id = m.project_id')
            ->join('users u', 'u.id = p.owner_id')
            ->where(['m.user_id' => Rl::uid(), 'p.deleted_at' => null])
            ->orderBy('p.updated_at', 'DESC')->get()->getResultArray();
        foreach ($rows as &$r) {
            $r['updated_at'] = Rl::iso($r['updated_at']);
            $r['id'] = (int) $r['id'];
            $r['version'] = (int) $r['version'];
        }

        return $this->response->setJSON(['projects' => $rows]);
    }

    public function create()
    {
        $b = $this->body();
        $data = is_object($b->data ?? null) ? $b->data : new \stdClass();
        $json = $this->enc($data);
        if (strlen($json) > self::MAX_DATA) {
            return $this->err(413, 'Data proyek terlalu besar.');
        }
        $db = Rl::db();
        $now = Rl::now();
        $db->table('projects')->insert(['owner_id' => Rl::uid(), 'title' => $this->titleOf($data), 'step' => $this->stepOf($data), 'data' => $json, 'version' => 1, 'updated_by' => Rl::uid(), 'created_at' => $now, 'updated_at' => $now]);
        $id = (int) $db->insertID();
        $db->table('project_members')->insert(['project_id' => $id, 'user_id' => Rl::uid(), 'role' => 'owner', 'created_at' => $now]);
        $this->snapshot($id, 1, $json, (string) ($b->note ?? 'Proyek dibuat'));

        return $this->response->setStatusCode(201)->setJSON(['id' => $id, 'version' => 1]);
    }

    public function show(int $id)
    {
        $role = $this->role($id);
        if (! $role) {
            return $this->err(404, 'Proyek tidak ditemukan atau Anda bukan anggotanya.');
        }
        $db = Rl::db();
        $p = $db->table('projects')->where('id', $id)->get()->getRow();
        $by = $p->updated_by ? $db->table('users')->select('username')->where('id', $p->updated_by)->get()->getRow() : null;

        return $this->withRawData([
            'id' => (int) $p->id, 'title' => $p->title, 'version' => (int) $p->version, 'role' => $role,
            'updated_at' => Rl::iso($p->updated_at), 'updated_by' => $by->username ?? '',
            'members' => $this->membersOf($id),
        ], $p->data);
    }

    /** Simpan. baseVersion wajib sama dengan versi di server, kecuali force (menimpa perubahan anggota lain). */
    public function update(int $id)
    {
        $role = $this->role($id);
        if (! $role) {
            return $this->err(404, 'Proyek tidak ditemukan atau Anda bukan anggotanya.');
        }
        if ($role === 'viewer') {
            return $this->err(403, 'Anda hanya dapat membaca proyek ini.');
        }
        $b = $this->body();
        if (! is_object($b->data ?? null)) {
            return $this->err(400, 'Data proyek tidak valid.');
        }
        $json = $this->enc($b->data);
        if (strlen($json) > self::MAX_DATA) {
            return $this->err(413, 'Data proyek terlalu besar.');
        }
        $db = Rl::db();
        $db->transStart();
        $p = $db->table('projects')->where('id', $id)->get()->getRow();
        if ((int) ($b->baseVersion ?? -1) !== (int) $p->version && empty($b->force)) {
            $db->transComplete();
            $by = $p->updated_by ? $db->table('users')->select('username')->where('id', $p->updated_by)->get()->getRow() : null;

            return $this->response->setStatusCode(409)->setJSON([
                'error' => 'Proyek sudah diubah di tempat lain.', 'code' => 'conflict',
                'version' => (int) $p->version, 'updated_at' => Rl::iso($p->updated_at), 'updated_by' => $by->username ?? '',
            ]);
        }
        $version = (int) $p->version + 1;
        // Versi bersyarat: hanya berhasil bila belum ada penyimpanan lain di antaranya.
        $db->table('projects')->where(['id' => $id, 'version' => $p->version])
            ->update(['data' => $json, 'title' => $this->titleOf($b->data), 'step' => $this->stepOf($b->data), 'version' => $version, 'updated_by' => Rl::uid(), 'updated_at' => Rl::now()]);
        $saved = $db->affectedRows() === 1;
        if ($saved) {
            $last = $db->table('project_versions')->selectMax('created_at')->where('project_id', $id)->get()->getRow();
            $note = trim((string) ($b->note ?? ''));
            if ($note !== '' || ! $last || ! $last->created_at || strtotime($last->created_at . ' UTC') < time() - self::SNAPSHOT_EVERY) {
                $this->snapshot($id, $version, $json, $note !== '' ? $note : 'Simpan otomatis');
            }
        }
        $db->transComplete();
        if (! $saved) {
            return $this->response->setStatusCode(409)->setJSON(['error' => 'Proyek sudah diubah di tempat lain.', 'code' => 'conflict']);
        }

        return $this->response->setJSON(['version' => $version, 'updated_at' => Rl::iso(Rl::now())]);
    }

    public function delete(int $id)
    {
        if ($this->role($id) !== 'owner') {
            return $this->err(403, 'Hanya pemilik yang dapat menghapus proyek.');
        }
        Rl::db()->table('projects')->where('id', $id)->update(['deleted_at' => Rl::now()]);

        return $this->response->setJSON(['ok' => true]);
    }

    // ---------- versi ----------
    public function versions(int $id)
    {
        if (! $this->role($id)) {
            return $this->err(404, 'Proyek tidak ditemukan.');
        }
        $rows = Rl::db()->table('project_versions v')->select('v.id, v.version, v.note, v.created_at, u.username, LENGTH(v.data) AS size')
            ->join('users u', 'u.id = v.user_id', 'left')->where('v.project_id', $id)->orderBy('v.id', 'DESC')->limit(100)->get()->getResultArray();
        foreach ($rows as &$r) {
            $r['created_at'] = Rl::iso($r['created_at']);
            $r['id'] = (int) $r['id'];
            $r['version'] = (int) $r['version'];
            $r['size'] = (int) $r['size'];
        }

        return $this->response->setJSON(['versions' => $rows]);
    }

    public function restore(int $id, int $vid)
    {
        $role = $this->role($id);
        if (! $role || $role === 'viewer') {
            return $this->err(403, 'Anda tidak dapat memulihkan versi proyek ini.');
        }
        $db = Rl::db();
        $v = $db->table('project_versions')->where(['id' => $vid, 'project_id' => $id])->get()->getRow();
        if (! $v) {
            return $this->err(404, 'Versi tidak ditemukan.');
        }
        $p = $db->table('projects')->where('id', $id)->get()->getRow();
        $version = (int) $p->version + 1;
        $data = json_decode((string) $v->data) ?: new \stdClass();
        $db->table('projects')->where('id', $id)->update(['data' => $v->data, 'title' => $this->titleOf($data), 'step' => $this->stepOf($data), 'version' => $version, 'updated_by' => Rl::uid(), 'updated_at' => Rl::now()]);
        $this->snapshot($id, $version, (string) $v->data, 'Dipulihkan dari versi ' . $v->version);

        return $this->withRawData(['version' => $version], $v->data);
    }

    // ---------- kunci Rencana Hasil ----------
    public function lock(int $id)
    {
        $role = $this->role($id);
        if (! $role || $role === 'viewer') {
            return $this->err(403, 'Anda tidak dapat mengunci rencana proyek ini.');
        }
        $b = $this->request->getJSON(true) ?? [];
        $snap = (string) ($b['snapshot'] ?? '');
        if ($snap === '' || ! is_array(json_decode($snap, true)) || strlen($snap) > 2 * 1024 * 1024) {
            return $this->err(400, 'Rencana tidak valid.');
        }
        $hash = hash('sha256', $snap);
        $now = Rl::now();
        Rl::db()->table('plan_locks')->insert(['project_id' => $id, 'user_id' => Rl::uid(), 'hash' => $hash, 'snapshot' => $snap, 'locked_at' => $now]);

        return $this->response->setJSON(['id' => (int) Rl::db()->insertID(), 'hash' => $hash, 'locked_at' => Rl::iso($now)]);
    }

    public function locks(int $id)
    {
        if (! $this->role($id)) {
            return $this->err(404, 'Proyek tidak ditemukan.');
        }
        $rows = Rl::db()->table('plan_locks l')->select('l.id, l.hash, l.locked_at, u.username')->join('users u', 'u.id = l.user_id', 'left')
            ->where('l.project_id', $id)->orderBy('l.id', 'DESC')->get()->getResultArray();
        foreach ($rows as &$r) {
            $r['locked_at'] = Rl::iso($r['locked_at']);
        }

        return $this->response->setJSON(['locks' => $rows]);
    }

    // ---------- anggota tim ----------
    private function membersOf(int $id): array
    {
        $rows = Rl::db()->table('project_members m')->select('m.user_id, m.role, u.username, u.name')->join('users u', 'u.id = m.user_id')
            ->where('m.project_id', $id)->orderBy('m.created_at')->get()->getResultArray();
        foreach ($rows as &$r) {
            $r['user_id'] = (int) $r['user_id'];
        }

        return $rows;
    }

    public function addMember(int $id)
    {
        if ($this->role($id) !== 'owner') {
            return $this->err(403, 'Hanya pemilik yang dapat mengatur anggota.');
        }
        $b = $this->request->getJSON(true) ?? [];
        $role = in_array($b['role'] ?? '', ['editor', 'viewer'], true) ? $b['role'] : 'editor';
        $u = Rl::db()->table('users')->where(['username' => strtolower(trim((string) ($b['username'] ?? ''))), 'active' => 1])->get()->getRow();
        if (! $u) {
            return $this->err(404, 'Username tidak ditemukan. Minta admin membuatkan akunnya terlebih dahulu.');
        }
        $db = Rl::db();
        $exists = $db->table('project_members')->where(['project_id' => $id, 'user_id' => $u->id])->get()->getRow();
        if ($exists && $exists->role === 'owner') {
            return $this->err(400, 'Pemilik tidak dapat diubah perannya.');
        }
        if ($exists) {
            $db->table('project_members')->where(['project_id' => $id, 'user_id' => $u->id])->update(['role' => $role]);
        } else {
            $db->table('project_members')->insert(['project_id' => $id, 'user_id' => $u->id, 'role' => $role, 'created_at' => Rl::now()]);
        }

        return $this->response->setJSON(['members' => $this->membersOf($id)]);
    }

    public function removeMember(int $id, int $userId)
    {
        $me = Rl::uid();
        $role = $this->role($id);
        if ($role !== 'owner' && $userId !== $me) {
            return $this->err(403, 'Hanya pemilik yang dapat mengatur anggota.');
        }
        $m = Rl::db()->table('project_members')->where(['project_id' => $id, 'user_id' => $userId])->get()->getRow();
        if (! $m || $m->role === 'owner') {
            return $this->err(400, 'Pemilik tidak dapat dikeluarkan.');
        }
        Rl::db()->table('project_members')->where(['project_id' => $id, 'user_id' => $userId])->delete();

        return $this->response->setJSON(['members' => $this->membersOf($id)]);
    }

    // ---------- gambar hasil ----------
    public function files(int $id)
    {
        if (! $this->role($id)) {
            return $this->err(404, 'Proyek tidak ditemukan.');
        }
        $out = [];
        foreach (Rl::db()->table('project_files')->select('fkey, data')->where('project_id', $id)->get()->getResultArray() as $r) {
            $out[$r['fkey']] = $r['data'];
        }

        return $this->response->setJSON(['files' => (object) $out]);
    }

    public function putFiles(int $id)
    {
        $role = $this->role($id);
        if (! $role || $role === 'viewer') {
            return $this->err(403, 'Anda tidak dapat mengubah file proyek ini.');
        }
        $b = $this->request->getJSON(true) ?? [];
        $files = is_array($b['files'] ?? null) ? $b['files'] : [];
        $rows = [];
        $total = 0;
        foreach ($files as $k => $v) {
            if (! preg_match('/^F\d{1,3}$/', (string) $k) || ! is_string($v) || ! preg_match('#^data:(image/(png|jpeg));base64,[A-Za-z0-9+/=]+$#', $v, $m)) {
                continue;
            }
            $total += strlen($v);
            $rows[] = ['project_id' => $id, 'fkey' => $k, 'mime' => $m[1], 'data' => $v, 'size' => strlen($v), 'created_at' => Rl::now()];
        }
        if ($total > self::MAX_FILES) {
            return $this->err(413, 'Total gambar melebihi 25 MB.');
        }
        $db = Rl::db();
        $db->transStart();
        $db->table('project_files')->where('project_id', $id)->delete();
        if ($rows) {
            $db->table('project_files')->insertBatch($rows);
        }
        $db->transComplete();

        return $this->response->setJSON(['count' => count($rows)]);
    }
}
