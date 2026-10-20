<?php
/**
 * קטע קוד שני לוורדפרס (iska.co.il), בנוסף לקטע שולח המיילים: מאפשר לאתר החדש למשוך מהאתר החי
 * (ולא מגיבוי) את ההגשות החדשות של הטפסים (CFDB7) ואת קובצי האישור (PDF) שלהן. קריאה בלבד.
 * הוספה: WPCode → Add Snippet → PHP Snippet → הדבקה → Active.  (אם התוסף מוסיף <?php בעצמו, להדביק בלי השורה הראשונה.)
 * חובה: להחליף את CHANGE_ME_LONG_RANDOM באותה סיסמה בדיוק שבקטע השני (ושמוגדרת באתר החדש כ-WP_MAIL_SECRET).
 */
const ISKA_SYNC_SECRET = 'CHANGE_ME_LONG_RANDOM';

function iska_sync_ok(WP_REST_Request $req) {
  $given = (string) $req->get_header('x_iska_secret');
  return ISKA_SYNC_SECRET !== 'CHANGE_ME_LONG_RANDOM' && hash_equals(ISKA_SYNC_SECRET, $given);
}
function iska_flat($v) {
  if (is_array($v)) return implode(', ', array_map('iska_flat', $v));
  return is_scalar($v) ? (string) $v : '';
}

add_action('rest_api_init', function () {
  // הגשות של טופס (91 = הצטרפות, 118 = ביטול) שמספרן גדול מ-since_id, מהישנה לחדשה
  register_rest_route('iska/v1', '/cf7-rows', [
    'methods' => 'GET',
    'permission_callback' => '__return_true',
    'callback' => function (WP_REST_Request $req) {
      if (!iska_sync_ok($req)) return new WP_REST_Response(['ok' => false], 403);
      global $wpdb;
      $form  = (int) $req->get_param('form');  if (!in_array($form, [91, 118], true)) return new WP_REST_Response(['ok' => false], 400);
      $since = max(0, (int) $req->get_param('since_id'));
      $limit = min(50, max(1, (int) ($req->get_param('limit') ?: 20)));
      $t = $wpdb->prefix . 'db7_forms';
      $rows = $wpdb->get_results($wpdb->prepare("SELECT form_id, form_value, form_date FROM $t WHERE form_post_id = %d AND form_id > %d ORDER BY form_id ASC LIMIT %d", $form, $since, $limit), ARRAY_A);
      $out = [];
      foreach ((array) $rows as $r) {
        $f = @unserialize($r['form_value'], ['allowed_classes' => false]);
        if (!is_array($f)) continue;
        $out[] = ['id' => (int) $r['form_id'], 'date' => $r['form_date'], 'fields' => array_map('iska_flat', $f)];
      }
      $max = (int) $wpdb->get_var($wpdb->prepare("SELECT MAX(form_id) FROM $t WHERE form_post_id = %d", $form));
      return new WP_REST_Response(['ok' => true, 'rows' => $out, 'max_id' => $max]);
    },
  ]);

  // קובץ אישור (PDF) לפי שם, מתיקיית התוסף. מוחזר ב-base64 בתוך JSON.
  register_rest_route('iska/v1', '/cf7-pdf', [
    'methods' => 'GET',
    'permission_callback' => '__return_true',
    'callback' => function (WP_REST_Request $req) {
      if (!iska_sync_ok($req)) return new WP_REST_Response(['ok' => false], 403);
      $form = (int) $req->get_param('form'); if (!in_array($form, [91, 118], true)) return new WP_REST_Response(['ok' => false], 400);
      $name = basename((string) $req->get_param('name'));
      if (!preg_match('/\.pdf$/i', $name)) $name .= '.pdf';   // בטפסים מופיע לעיתים רק שם הקובץ, בלי הסיומת
      if (strpos($name, '..') !== false) return new WP_REST_Response(['ok' => false], 400);
      $up = wp_upload_dir();
      $dir = realpath($up['basedir'] . '/sendpdfcf7_uploads/' . $form);
      $path = $dir ? realpath($dir . '/' . $name) : false;
      if (!$path || strpos($path, $dir . DIRECTORY_SEPARATOR) !== 0 || !is_file($path)) return new WP_REST_Response(['ok' => false, 'error' => 'not found'], 404);
      if (filesize($path) > 3 * 1024 * 1024) return new WP_REST_Response(['ok' => false, 'error' => 'too big'], 413);
      return new WP_REST_Response(['ok' => true, 'name' => $name, 'b64' => base64_encode(file_get_contents($path))]);
    },
  ]);

  // אבחון: שמות קובצי האישור האחרונים בתיקייה (כדי לבדוק התאמה לשמות בטפסים)
  register_rest_route('iska/v1', '/cf7-pdf-list', [
    'methods' => 'GET',
    'permission_callback' => '__return_true',
    'callback' => function (WP_REST_Request $req) {
      if (!iska_sync_ok($req)) return new WP_REST_Response(['ok' => false], 403);
      $form = (int) $req->get_param('form'); if (!in_array($form, [91, 118], true)) return new WP_REST_Response(['ok' => false], 400);
      $up = wp_upload_dir();
      $files = glob($up['basedir'] . '/sendpdfcf7_uploads/' . $form . '/*.pdf') ?: [];
      usort($files, function ($a, $b) { return filemtime($b) - filemtime($a); });
      $files = array_slice($files, 0, 15);
      return new WP_REST_Response(['ok' => true, 'dir_exists' => is_dir($up['basedir'] . '/sendpdfcf7_uploads/' . $form), 'files' => array_map('basename', $files)]);
    },
  ]);
});
