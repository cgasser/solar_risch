<?php
/**
 * Mini-Proxy für die offenen Energie-Reporter-Datensätze
 * (geoimpact AG / EnergieSchweiz, Lizenz CC BY 4.0).
 *
 * Zweck: Die Browser-App lädt die ZIPs über die eigene Domain
 * (kein CORS-Problem) und der Server cached sie 12 Stunden,
 * damit die Quelle geschont wird.
 */

$files = [
    'latest'     => 'https://opendata.geoimpact.ch/energiereporter/energyreporter_latest.zip',
    'historized' => 'https://opendata.geoimpact.ch/energiereporter/energyreporter_historized.zip',
];

$key = $_GET['file'] ?? 'latest';
if (!isset($files[$key])) {
    http_response_code(400);
    exit('Unbekannter Datensatz. Erlaubt: latest, historized');
}

$cacheDir = sys_get_temp_dir();
$cache    = $cacheDir . '/energiereporter_' . $key . '.zip';
$maxAge   = 12 * 3600; // 12 Stunden

$stale = !is_file($cache) || (time() - filemtime($cache)) > $maxAge;

if ($stale) {
    $data = false;

    // Variante 1: file_get_contents (falls allow_url_fopen aktiv)
    $ctx = stream_context_create(['http' => ['timeout' => 20]]);
    $data = @file_get_contents($files[$key], false, $ctx);

    // Variante 2: cURL als Fallback
    if (($data === false || strlen($data) < 1000) && function_exists('curl_init')) {
        $ch = curl_init($files[$key]);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT        => 25,
        ]);
        $data = curl_exec($ch);
        curl_close($ch);
    }

    if ($data !== false && strlen($data) > 1000) {
        @file_put_contents($cache, $data, LOCK_EX);
    }
}

if (!is_file($cache)) {
    http_response_code(502);
    exit('Datenquelle momentan nicht erreichbar.');
}

header('Content-Type: application/zip');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=3600');
header('X-Data-Source: Energie Reporter (geoimpact / EnergieSchweiz), CC BY 4.0');
readfile($cache);
