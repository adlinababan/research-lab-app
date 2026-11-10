<?php

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use App\Libraries\Rl;

/**
 * Meneruskan permintaan AI, OpenAlex, ekspor .docx, dan cek key ke layanan Node internal
 * (127.0.0.1, token internal). CodeIgniter memeriksa login, membatasi pemakaian per akun (MySQL),
 * dan mencatat setiap panggilan di ai_logs.
 */
class Proxy extends BaseController
{
    /** Batas permintaan per akun per menit. */
    private const LIMITS = ['llm' => 15, 'search' => 60, 'docx' => 20, 'check' => 10];

    private function node(): string
    {
        return rtrim(Rl::env('RL_NODE_URL', 'http://127.0.0.1:3311'), '/');
    }

    /** @return array{0:int,1:array<string,string>,2:string} */
    private function call(string $method, string $path, ?string $body, array $extra = [], int $timeout = 240): array
    {
        $headers = array_merge(['x-internal-token: ' . Rl::env('RL_INTERNAL_TOKEN')], $extra);
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
        }
        $resHeaders = [];
        $ch = curl_init($this->node() . $path);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_HEADERFUNCTION => static function ($c, $line) use (&$resHeaders) {
                $p = explode(':', $line, 2);
                if (count($p) === 2) {
                    $resHeaders[strtolower(trim($p[0]))] = trim($p[1]);
                }

                return strlen($line);
            },
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $out = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($out === false || $status === 0) {
            return [502, ['content-type' => 'application/json'], json_encode(['error' => 'Layanan AI internal tidak dapat dihubungi. Hubungi admin (cek layanan research-lab-node).', 'detail' => $err])];
        }

        return [$status, $resHeaders, (string) $out];
    }

    public function config()
    {
        [$status, , $body] = $this->call('GET', '/api/config', null, [], 10);
        $cfg = $status === 200 ? (json_decode($body, true) ?: []) : ['nodeError' => true];
        $cfg['loginRequired'] = true;
        $cfg['accessRequired'] = false;
        $cfg['server'] = 'ci4';
        $cfg['auth'] = 'session';

        return $this->response->setHeader('Cache-Control', 'no-store')->setJSON($cfg);
    }

    public function forward(string $endpoint)
    {
        if (! isset(self::LIMITS[$endpoint])) {
            return $this->response->setStatusCode(404)->setJSON(['error' => 'Tidak ditemukan.']);
        }
        $uid = Rl::uid();
        $db = Rl::db();
        $recent = $db->table('ai_logs')->where(['user_id' => $uid, 'endpoint' => $endpoint, 'created_at >=' => gmdate('Y-m-d H:i:s', time() - 60)])->countAllResults();
        if ($recent >= self::LIMITS[$endpoint]) {
            return $this->response->setStatusCode(429)->setJSON(['error' => 'Terlalu banyak permintaan dalam satu menit. Tunggu sebentar lalu coba lagi.', 'code' => 'rate']);
        }
        set_time_limit(300);
        $raw = (string) $this->request->getBody();
        $b = json_decode($raw, true) ?: [];
        $extra = ['x-client-id: u' . $uid, 'x-rl-user: ' . $uid];
        foreach (['x-ai-key', 'x-gemini-key', 'x-openalex-key'] as $h) {
            $v = $this->request->getHeaderLine($h);
            if ($v !== '') {
                $extra[] = $h . ': ' . preg_replace('/[^A-Za-z0-9_\-.]/', '', $v);
            }
        }
        $t0 = microtime(true);
        [$status, $headers, $body] = $this->call('POST', '/api/' . $endpoint, $raw, $extra);
        $model = '';
        if (str_contains($headers['content-type'] ?? '', 'json')) {
            $j = json_decode($body, true);
            $model = is_array($j) ? (string) ($j['model'] ?? '') : '';
        }
        $pid = (int) $this->request->getHeaderLine('x-project-id');
        $db->table('ai_logs')->insert([
            'user_id' => $uid, 'project_id' => $pid ?: null, 'endpoint' => $endpoint,
            'task' => substr((string) ($b['task'] ?? ''), 0, 20), 'model' => substr($model, 0, 80),
            'status' => $status, 'duration_ms' => (int) round((microtime(true) - $t0) * 1000), 'created_at' => Rl::now(),
        ]);
        $res = $this->response->setStatusCode($status)->setBody($body)->setHeader('Cache-Control', 'no-store');
        foreach (['content-type', 'content-disposition'] as $h) {
            if (isset($headers[$h])) {
                $res->setHeader($h, $headers[$h]);
            }
        }

        return $res;
    }
}
