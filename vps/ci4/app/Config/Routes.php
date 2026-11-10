<?php

use CodeIgniter\Router\RouteCollection;

/**
 * Nginx mengirim /api/* dan /admin* ke CodeIgniter; berkas tampilan web (index.html, app.js, …)
 * dilayani langsung oleh Nginx dari folder public/ aplikasi utama.
 *
 * @var RouteCollection $routes
 */
$routes->get('/', static fn () => redirect()->to('/admin'));

// ---- API untuk tampilan web ----
$routes->get('api/config', 'Api\Proxy::config');
$routes->post('api/login', 'Api\Auth::login', ['filter' => 'jsononly']);
$routes->get('api/login', 'Api\Auth::me');
$routes->group('api', ['filter' => 'apiauth'], static function ($routes) {
    $routes->post('logout', 'Api\Auth::logout');
    $routes->post('password', 'Api\Auth::password');

    $routes->get('projects', 'Api\Projects::index');
    $routes->post('projects', 'Api\Projects::create');
    $routes->get('projects/(:num)', 'Api\Projects::show/$1');
    $routes->put('projects/(:num)', 'Api\Projects::update/$1');
    $routes->post('projects/(:num)/save', 'Api\Projects::update/$1'); // untuk navigator.sendBeacon saat halaman ditutup
    $routes->delete('projects/(:num)', 'Api\Projects::delete/$1');
    $routes->get('projects/(:num)/versions', 'Api\Projects::versions/$1');
    $routes->post('projects/(:num)/versions/(:num)/restore', 'Api\Projects::restore/$1/$2');
    $routes->post('projects/(:num)/lock', 'Api\Projects::lock/$1');
    $routes->get('projects/(:num)/locks', 'Api\Projects::locks/$1');
    $routes->post('projects/(:num)/members', 'Api\Projects::addMember/$1');
    $routes->delete('projects/(:num)/members/(:num)', 'Api\Projects::removeMember/$1/$2');
    $routes->get('projects/(:num)/files', 'Api\Projects::files/$1');
    $routes->put('projects/(:num)/files', 'Api\Projects::putFiles/$1');

    $routes->post('(search|llm|docx|check)', 'Api\Proxy::forward/$1');
});

// ---- Panel admin ----
$routes->get('admin/login', 'Admin::loginForm');
$routes->post('admin/login', 'Admin::login');
$routes->group('admin', ['filter' => 'adminauth'], static function ($routes) {
    $routes->get('/', 'Admin::index');
    $routes->post('logout', 'Admin::logout');
    $routes->get('users', 'Admin::users');
    $routes->post('users', 'Admin::createUser');
    $routes->post('users/(:num)', 'Admin::updateUser/$1');
    $routes->get('projects', 'Admin::projects');
    $routes->get('usage', 'Admin::usage');
});
