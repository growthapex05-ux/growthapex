<?php
if ($_SERVER["REQUEST_METHOD"] == "POST") {

    // Sanitize inputs
    $name = strip_tags(trim($_POST["name"]));
    $name = str_replace(array("\r","\n"), array(" "," "), $name);
    $email = filter_var(trim($_POST["email"]), FILTER_SANITIZE_EMAIL);
    $message = trim($_POST["message"]);

    // Validation
    if (empty($name) || empty($message) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        http_response_code(400);
        echo "Please complete the form correctly.";
        exit;
    }

    // Your receiving email
    $recipient = "support@growthapex.in";

    $subject = "New Contact Message from $name";

    // Email content
    $email_content = "Name: $name\n";
    $email_content .= "Email: $email\n\n";
    $email_content .= "Message:\n$message\n";

    // Handle file upload
    $attachment = $_FILES['file'];

    $boundary = md5(time());

    $headers = "From: $name <$email>\r\n";
    $headers .= "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: multipart/mixed; boundary=\"$boundary\"";

    $body = "--$boundary\r\n";
    $body .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $body .= "Content-Transfer-Encoding: 7bit\r\n\r\n";
    $body .= $email_content . "\r\n";

    // If file exists
    if (!empty($attachment['name']) && $attachment['error'] == 0) {

        $file_tmp = $attachment['tmp_name'];
        $file_name = $attachment['name'];
        $file_size = $attachment['size'];
        $file_type = $attachment['type'];

        $file_data = chunk_split(base64_encode(file_get_contents($file_tmp)));

        $body .= "--$boundary\r\n";
        $body .= "Content-Type: $file_type; name=\"$file_name\"\r\n";
        $body .= "Content-Transfer-Encoding: base64\r\n";
        $body .= "Content-Disposition: attachment; filename=\"$file_name\"\r\n\r\n";
        $body .= $file_data . "\r\n";
    }

    $body .= "--$boundary--";

    // Send mail
    if (mail($recipient, $subject, $body, $headers)) {
        http_response_code(200);
        echo "Thank you! Your message has been sent successfully.";
    } else {
        http_response_code(500);
        echo "Something went wrong. Please try again.";
    }

} else {
    http_response_code(403);
    echo "Invalid request.";
}
?>