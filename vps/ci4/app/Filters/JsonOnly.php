<?php

namespace App\Filters;

use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;

/** Login lewat API wajib JSON (perlindungan CSRF sederhana; lihat ApiAuth). */
class JsonOnly implements FilterInterface
{
    public function before(RequestInterface $request, $arguments = null)
    {
        if (! str_starts_with(strtolower($request->getHeaderLine('Content-Type')), 'application/json')) {
            return service('response')->setStatusCode(415)->setJSON(['error' => 'Permintaan harus berformat JSON.']);
        }

        return null;
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
    }
}
