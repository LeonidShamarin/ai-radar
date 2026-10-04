<?php
// PHP port of lib/proxy.js for hosts with nginx + php-fpm (the Semalt workspace).
// Installed as /var/www/html/api/freeserp/index.php; install.sh points the deployed client at that path.
// Same rules: fixed upstream, whitelisted parameters with length caps, not an open proxy.

const UPSTREAM = 'https://freeserp.ai/api.php';
const TIMEOUT_S = 12;
const ALLOWED = [
    'q' => 200, 'ai_startups' => 1, 'ai_categories' => 100, 'ai_source' => 50,
    'category' => 30, 'dr_min' => 3, 'dr_max' => 3, 'from_date' => 10, 'to_date' => 10,
    'sort' => 30, 'order' => 4, 'size' => 3, 'from' => 5, 'stats' => 1, 'all' => 1,
];

function send(int $status, string $body, int $cacheSeconds = 0): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header($cacheSeconds ? "Cache-Control: public, max-age=60, s-maxage=$cacheSeconds" : 'Cache-Control: no-store');
    echo $body;
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    send(405, '{"ok":false,"error":"method_not_allowed"}');
}

$out = [];
foreach (ALLOWED as $key => $max) {
    $value = $_GET[$key] ?? null;
    if (is_string($value) && $value !== '') {
        $out[$key] = mb_substr($value, 0, $max);
    }
}
$out['project'] = 'ai-radar-demo';
$url = UPSTREAM . '?' . http_build_query($out);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => TIMEOUT_S,
    CURLOPT_HTTPHEADER => ['Accept: application/json'],
    CURLOPT_USERAGENT => 'ai-radar-demo (+https://github.com/LeonidShamarin/ai-radar)',
]);
$body = curl_exec($ch);
$status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$errno = curl_errno($ch);
curl_close($ch);

if ($body === false || $status === 0) {
    $timedOut = $errno === CURLE_OPERATION_TIMEDOUT;
    send($timedOut ? 504 : 502, $timedOut ? '{"ok":false,"error":"upstream_timeout"}' : '{"ok":false,"error":"upstream_unreachable"}');
}
// Cache only successful answers; errors should be retried.
send($status, $body, $status >= 200 && $status < 300 ? 300 : 0);
