<?php
/**
 * קטע קוד לוורדפרס (iska.co.il): מקבל בקשה מהאתר החדש ושולח מייל מהדומיין (אישור הצטרפות, טופס הצטרפות במייל וכו').
 * הוספה: WPCode → Add Snippet → PHP Snippet → הדבקה → Active. (אם התוסף מוסיף <?php בעצמו, להדביק בלי השורה הראשונה.)
 * חובה: להחליף את CHANGE_ME_LONG_RANDOM בסיסמה ארוכה אקראית. אותה סיסמה מוגדרת באתר החדש כ-WP_MAIL_SECRET.
 *   (בעדכון של קטע קיים: להעתיק קודם את הסיסמה שכבר כתובה בו, ולהחזיר אותה לשורה הזו.)
 * reply_to (לא חובה): כתובת לתשובות. amp (לא חובה): חלק AMP (טופס חי בתוך Gmail) - נשלח כמייל multipart/alternative
 *   (טקסט, AMP, HTML) דרך mail() של השרת; אם נכשל - נשלח המייל הרגיל בלי AMP.
 */
const ISKA_MAIL_SECRET = 'CHANGE_ME_LONG_RANDOM';
const ISKA_MAIL_FROM   = 'מכון היתר עיסקא <wordpress@iska.co.il>';

if (!function_exists('iska_send_amp_mail')) {
  function iska_send_amp_mail($to, $subject, $html, $text, $amp, $reply_to) {
    $enc = function ($s) { return '=?UTF-8?B?' . base64_encode($s) . '?='; };
    $from_name = ''; $from_addr = ISKA_MAIL_FROM;
    if (preg_match('/^(.*)<([^>]+)>\s*$/u', ISKA_MAIL_FROM, $m)) { $from_name = trim($m[1]); $from_addr = trim($m[2]); }
    $boundary = 'iska_' . md5(uniqid('', true));
    $part = function ($type, $body) use ($boundary) {
      return "--$boundary\r\nContent-Type: $type; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($body), 76, "\r\n");
    };
    if ($text === '') $text = wp_strip_all_tags($html);
    $body = $part('text/plain', $text) . $part('text/x-amp-html', $amp) . $part('text/html', $html) . "--$boundary--\r\n";
    $headers = "MIME-Version: 1.0\r\n"
      . 'From: ' . ($from_name !== '' ? $enc($from_name) . " <$from_addr>" : $from_addr) . "\r\n"
      . ($reply_to ? "Reply-To: $reply_to\r\n" : '')
      . "Content-Type: multipart/alternative; boundary=\"$boundary\"";
    return mail($to, $enc($subject), $body, $headers, '-f' . $from_addr);
  }
}

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
      // כתובת לתשובות (הצטרפות במייל): התשובה של המצטרף חוזרת לכתובת ההצטרפות ולא ל-wordpress@
      $reply_to = isset($b['reply_to']) ? sanitize_email($b['reply_to']) : '';
      if (!$reply_to || !is_email($reply_to)) $reply_to = '';
      // טופס חי בתוך Gmail (AMP)
      if (!empty($b['amp'])) {
        $text = isset($b['text']) ? (string) $b['text'] : '';
        if (iska_send_amp_mail($to, $subject, (string) $b['html'], $text, (string) $b['amp'], $reply_to)) {
          return new WP_REST_Response(['ok' => true, 'amp' => true], 200);
        }
      }
      $headers = ['Content-Type: text/html; charset=UTF-8', 'From: ' . ISKA_MAIL_FROM];
      if ($reply_to) $headers[] = 'Reply-To: ' . $reply_to;
      $ok = wp_mail($to, $subject, (string) $b['html'], $headers);
      return new WP_REST_Response(['ok' => (bool) $ok], $ok ? 200 : 500);
    },
  ]);
});
