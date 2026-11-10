<?php
/**
 * Router untuk uji lokal tanpa Nginx:
 *   php -S 127.0.0.1:8099 -t ../public dev-router.php
 * /api/* dan /admin* diteruskan ke CodeIgniter; berkas lain dilayani dari ../public (tampilan web).
 */
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/';
if (preg_match('#^/(api|admin)(/|$)#', $uri)) {
    $_SERVER['SCRIPT_NAME'] = '/index.php';
    $_SERVER['SCRIPT_FILENAME'] = __DIR__ . '/ci4/public/index.php';
    chdir(__DIR__ . '/ci4/public');
    require __DIR__ . '/ci4/public/index.php';

    return true;
}

return false;
