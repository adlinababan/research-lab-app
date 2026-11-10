<?php

namespace App\Filters;

use App\Libraries\Rl;
use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;

/** Halaman admin: wajib login dengan peran admin. */
class AdminAuth implements FilterInterface
{
    public function before(RequestInterface $request, $arguments = null)
    {
        $uid = Rl::uid();
        $u = $uid ? Rl::db()->table('users')->where('id', $uid)->get()->getRow() : null;
        if ($u && (int) $u->active === 1 && $u->role === 'admin') {
            return null;
        }
        if ($u) {
            return service('response')->setStatusCode(403)->setBody('Halaman ini hanya untuk admin. <a href="/">Kembali ke aplikasi</a>');
        }

        return redirect()->to('/admin/login');
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
        $response->setHeader('Cache-Control', 'no-store');
    }
}
