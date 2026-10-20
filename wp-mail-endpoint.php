<?php
/**
 * קטע קוד לוורדפרס (iska.co.il): מקבל בקשה מהאתר החדש ושולח מייל אישור הצטרפות מהדומיין.
 * הוספה: WPCode → Add Snippet → PHP Snippet → הדבקה → Active. (אם התוסף מוסיף <?php בעצמו, להדביק בלי השורה הראשונה.)
 * חובה: להחליף את CHANGE_ME_LONG_RANDOM בסיסמה ארוכה אקראית. אותה סיסמה מוגדרת באתר החדש כ-WP_MAIL_SECRET.
 */
const ISKA_MAIL_SECRET = 'CHANGE_ME_LONG_RANDOM';
const ISKA_MAIL_FROM   = 'מכון היתר עיסקא <wordpress@iska.co.il>';

add_action('rest_api_init', function () {
  register_rest_route('iska/v1', '/send-confirmation', [
    'methods' => 'POST',
    'permission_callback' => '__return_true',
    'callback' => function (WP_REST_Request $req) {
      $given = (string) $req->get_header('x_iska_secret');
      if (ISKA_MAIL_SECRET === 'CHANGE_ME_LONG_RANDOM' || !hash_equals(ISKA_MAIL_SECRET, $given)) {
        return new WP_REST_Response(['ok' => false], 403);
      }
      $b = $req->get_json_params();
      $to = isset($b['to']) ? sanitize_email($b['to']) : '';
      if (!$to || !is_email($to) || empty($b['html'])) return new WP_REST_Response(['ok' => false], 400);
      $subject = isset($b['subject']) ? wp_strip_all_tags((string) $b['subject']) : 'אישור הצטרפות';
      $headers = ['Content-Type: text/html; charset=UTF-8', 'From: ' . ISKA_MAIL_FROM];
      $ok = wp_mail($to, $subject, (string) $b['html'], $headers);
      return new WP_REST_Response(['ok' => (bool) $ok], $ok ? 200 : 500);
    },
  ]);
});
