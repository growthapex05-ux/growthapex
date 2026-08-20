/**
 *
 * -----------------------------------------------------------------------------
 *
 * Template : Agenio HTML TEMPLATE
 * Author : WordPressRiver
 * Author URI : https://wordpressriver.com/ 
 *
 * -----------------------------------------------------------------------------
 *
 **/

(function ($) {
    'use strict';
    // Get the form.
    var form = $('#contact-form');

    // Get the messages div.
    var formMessages = $('#form-messages');

    // Set up an event listener for the contact form.
    $(form).submit(function (e) {
        // Stop the browser from submitting the form.
        e.preventDefault();

        // Serialize the form data.
        var formData = $(form).serialize();

        // Submit the form using AJAX.
        $.ajax({
                type: 'POST',
                url: $(form).attr('action'),
                data: formData
            })
            .done(function (response) {
                // Make sure that the formMessages div has the 'success' class.
                $(formMessages).removeClass('error');
                $(formMessages).addClass('success');

                // Set the message text.
                $(formMessages).text(response);

                // Get values before clearing
                var nameVal = $('#name').val() || '';
                var emailVal = $('#email').val() || '';
                var messageVal = $('#message').val() || '';

                // Construct WhatsApp message
                var waMessage = "Hello Surya, a new client has submitted the contact form on GrowthApex:\n\n" +
                                "*Name:* " + nameVal + "\n" +
                                "*Email:* " + emailVal + "\n" +
                                "*Message:* " + messageVal;
                
                var waUrl = "https://wa.me/919217648531?text=" + encodeURIComponent(waMessage);
                
                // Open WhatsApp in a new tab
                window.open(waUrl, '_blank');

                // Clear the form.
                $('#name, #email, #message').val('');
            })
            .fail(function (data) {
                // Make sure that the formMessages div has the 'error' class.
                $(formMessages).removeClass('success');
                $(formMessages).addClass('error');

                // Set the message text.
                if (data.responseText !== '') {
                    $(formMessages).text(data.responseText);
                } else {
                    $(formMessages).text('Oops! An error occured and your message could not be sent.');
                }
            });
    });

})(jQuery);
