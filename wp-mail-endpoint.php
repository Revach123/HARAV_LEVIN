<?php
/**
 * קטע קוד לוורדפרס (iska.co.il): מקבל בקשה מהאתר החדש ושולח מייל מהדומיין (אישור הצטרפות, טופס הצטרפות במייל וכו').
 * הוספה: WPCode → Add Snippet → PHP Snippet → הדבקה → Active. (אם התוסף מוסיף <?php בעצמו, להדביק בלי השורה הראשונה.)
 * חובה: להחליף את CHANGE_ME_LONG_RANDOM בסיסמה ארוכה אקראית. אותה סיסמה מוגדרת באתר החדש כ-WP_MAIL_SECRET.
 *   (בעדכון של קטע קיים: להעתיק קודם את הסיסמה שכבר כתובה בו, ולהחזיר אותה לשורה הזו.)
 * reply_to (לא חובה): כתובת לתשובות. cc (לא חובה): עותק. amp (לא חובה): חלק AMP (טופס חי בתוך Gmail) - נשלח כמייל multipart/alternative
 *   (טקסט, AMP, HTML) דרך PHPMailer של וורדפרס; אם נכשל - נשלח המייל הרגיל, וב"הצגת המקור" כתוב X-Iska-Amp עם הסיבה.
 */
const ISKA_MAIL_SECRET = 'CHANGE_ME_LONG_RANDOM';
const ISKA_MAIL_FROM   = 'מכון היתר עיסקא <wordpress@iska.co.il>';

// מייל עם טופס חי (AMP): multipart/alternative (טקסט, AMP, HTML), נשלח דרך אותו PHPMailer של וורדפרס
// (כולל הגדרות שליחה של תוספים, phpmailer_init), כמו המיילים הרגילים. מחזיר '' בהצלחה, או את סיבת הכישלון.
if (!function_exists('iska_send_amp_mail')) {
  function iska_send_amp_mail($to, $subject, $html, $text, $amp, $reply_to, $cc = '') {
    try {
      if (!class_exists('PHPMailer\\PHPMailer\\PHPMailer')) {
        require_once ABSPATH . WPINC . '/PHPMailer/PHPMailer.php';
        require_once ABSPATH . WPINC . '/PHPMailer/SMTP.php';
        require_once ABSPATH . WPINC . '/PHPMailer/Exception.php';
      }
      $from_name = ''; $from_addr = ISKA_MAIL_FROM;
      if (preg_match('/^(.*)<([^>]+)>\s*$/u', ISKA_MAIL_FROM, $m)) { $from_name = trim($m[1]); $from_addr = trim($m[2]); }
      $boundary = 'iska_' . md5(uniqid('', true));
      $part = function ($type, $body) use ($boundary) {
        return "--$boundary\r\nContent-Type: $type; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($body), 76, "\r\n");
      };
      if ($text === '') $text = wp_strip_all_tags($html);
      $mail = new PHPMailer\PHPMailer\PHPMailer(true);
      $mail->isMail();
      $mail->CharSet = 'UTF-8';
      $mail->setFrom($from_addr, $from_name);
      $mail->addAddress($to);
      if ($reply_to) $mail->addReplyTo($reply_to);
      if ($cc) $mail->addCC($cc);
      $mail->Subject = $subject;
      do_action_ref_array('phpmailer_init', [&$mail]);          // הגדרות השליחה של האתר (למשל SMTP), כמו ב-wp_mail
      $mail->isHTML(false);
      $mail->Encoding = '7bit';
      $mail->ContentType = 'multipart/alternative; boundary="' . $boundary . '"';
      $mail->Body = $part('text/plain', $text) . $part('text/x-amp-html', $amp) . $part('text/html', $html) . "--$boundary--\r\n";
      $mail->AltBody = '';
      $mail->send();
      return '';
    } catch (\Throwable $e) {
      return substr(preg_replace('/\s+/', ' ', $e->getMessage()), 0, 150);
    }
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
      // עותק (למשל: מייל הרישום ל-Google, עם עותק למכון)
      $cc = isset($b['cc']) ? sanitize_email($b['cc']) : '';
      if (!$cc || !is_email($cc)) $cc = '';
      // טופס חי בתוך Gmail (AMP). אם נכשל - המייל הרגיל, עם הסיבה בכותרת X-Iska-Amp (לראות ב"הצגת המקור")
      $amp_note = 'none';
      if (!empty($b['amp'])) {
        $text = isset($b['text']) ? (string) $b['text'] : '';
        $err = iska_send_amp_mail($to, $subject, (string) $b['html'], $text, (string) $b['amp'], $reply_to, $cc);
        if ($err === '') return new WP_REST_Response(['ok' => true, 'amp' => true], 200);
        $amp_note = 'failed: ' . $err;
      }
      $headers = ['Content-Type: text/html; charset=UTF-8', 'From: ' . ISKA_MAIL_FROM, 'X-Iska-Amp: ' . $amp_note];
      if ($reply_to) $headers[] = 'Reply-To: ' . $reply_to;
      if ($cc) $headers[] = 'Cc: ' . $cc;
      $ok = wp_mail($to, $subject, (string) $b['html'], $headers);
      return new WP_REST_Response(['ok' => (bool) $ok], $ok ? 200 : 500);
    },
  ]);
});
