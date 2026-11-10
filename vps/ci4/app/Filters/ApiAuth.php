<?php

namespace App\Filters;

use App\Libraries\Rl;
use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;

/**
 * API wajib login (sesi). Permintaan yang mengubah data wajib berformat JSON: formulir lintas situs tidak
 * bisa mengirim Content-Type application/json tanpa izin CORS, sehingga ini sekaligus melindungi dari CSRF
 * (cookie sesi juga SameSite=Lax).
 */
class ApiAuth implements FilterInterface
{
    public function before(RequestInterface $request, $arguments = null)
    {
        $method = strtoupper($request->getMethod());
        if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)
            && ! str_starts_with(strtolower($request->getHeaderLine('Content-Type')), 'application/json')) {
            return service('response')->setStatusCode(415)->setJSON(['error' => 'Permintaan harus berformat JSON.']);
        }
        $uid = Rl::uid();
        if ($uid) {
            $u = Rl::db()->table('users')->select('id, active')->where('id', $uid)->get()->getRow();
            if ($u && (int) $u->active === 1) {
                return null;
            }
            session()->destroy();
        }

        return service('response')->setStatusCode(401)->setJSON(['error' => 'Silakan masuk dengan username dan password.', 'code' => 'login']);
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
        $response->setHeader('Cache-Control', 'no-store');
    }
}
