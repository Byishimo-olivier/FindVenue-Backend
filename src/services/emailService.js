const nodemailer = require('nodemailer');
const config = require('../config');

let transporter;
const emailSendTimeoutMs = Number(process.env.EMAIL_SEND_TIMEOUT_MS || 20000);

function isEmailConfigured() {
  return Boolean(config.mailUser && config.mailPassword);
}

function getEmailStatus() {
  return {
    configured: isEmailConfigured(),
    user: config.mailUser ? maskEmail(config.mailUser) : null,
    host: config.mailHost,
    port: config.mailPort,
    secure: config.mailSecure,
    requireTls: getRequireTls(),
  };
}

function maskEmail(value) {
  const [name, domain] = String(value).split('@');
  if (!domain) return 'configured';
  return `${name.slice(0, 2)}***@${domain}`;
}

function getTransporter() {
  if (!isEmailConfigured()) return null;

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mailHost,
      port: config.mailPort,
      secure: config.mailSecure,
      requireTLS: getRequireTls(),
      auth: {
        user: config.mailUser,
        pass: config.mailPassword,
      },
      tls: {
        servername: config.mailHost,
        rejectUnauthorized: false,
      },
      connectionTimeout: emailSendTimeoutMs,
      greetingTimeout: emailSendTimeoutMs,
      socketTimeout: emailSendTimeoutMs,
      logger: config.mailDebug,
      debug: config.mailDebug,
    });
  }

  return transporter;
}

function getRequireTls() {
  if (config.mailRequireTls !== undefined) return config.mailRequireTls;
  return !config.mailSecure && [25, 587].includes(config.mailPort);
}

function getEmailErrorReason(error) {
  const message = error.message || 'Email delivery failed.';
  if (!/tls|ssl|ssl3_read_bytes|alert internal error/i.test(message)) {
    return message;
  }

  return `${message} Check SMTP TLS settings: use MAIL_PORT=465 with MAIL_SECURE=true, or MAIL_PORT=587 with MAIL_SECURE=false for STARTTLS.`;
}

async function sendEmail({ to, subject, text, html }) {
  const mailer = getTransporter();
  if (!mailer) {
    console.log(`Email not configured - skipping email to ${to}`);
    return { sent: false, reason: 'Email credentials are not configured.' };
  }

  try {
    const info = await Promise.race([
      mailer.sendMail({
        from: `"Smart Event Venue" <${config.mailFrom}>`,
        to,
        subject,
        text,
        html,
      }),
      new Promise((_, reject) => {
        const timer = setTimeout(() => {
          const error = new Error(`Email delivery timed out after ${emailSendTimeoutMs}ms.`);
          error.code = 'EMAIL_SEND_TIMEOUT';
          reject(error);
        }, emailSendTimeoutMs);
        timer.unref?.();
      }),
    ]);

    console.log(`Email accepted by SMTP for ${to}: ${info.messageId || 'no message id'}`);
    return {
      sent: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    };
  } catch (error) {
    if (error.code === 'EMAIL_SEND_TIMEOUT' && transporter) {
      transporter.close();
      transporter = undefined;
    }
    const reason = getEmailErrorReason(error);
    console.error(`Email delivery failed: ${reason}`);
    // In development, don't fail if email fails - just log it
    if (config.exposeDevCodes) {
      console.warn('Continuing despite email error in development mode');
      return { sent: false, reason, isDevelopment: true };
    }
    return { sent: false, reason };
  }

}

async function sendVerificationCode({ to, fullName, code }) {
  return sendEmail({
    to,
    subject: 'Your Smart Event Venue verification code',
    text: `Hello ${fullName},\n\nYour verification code is ${code}. It expires in 10 minutes.\n\nSmart Event Venue`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#102033">
        <h2>Verify your Smart Event Venue account</h2>
        <p>Hello ${fullName},</p>
        <p>Your verification code is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
        <p>This code expires in 10 minutes.</p>
      </div>
    `,
  });
}

async function sendPasswordReset({ to, fullName, resetUrl }) {
  return sendEmail({
    to,
    subject: 'Reset your Smart Event Venue password',
    text: `Hello ${fullName},\n\nUse this link to reset your password:\n${resetUrl}\n\nThis link expires in 30 minutes.\n\nSmart Event Venue`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#102033">
        <h2>Reset your password</h2>
        <p>Hello ${fullName},</p>
        <p>Use the button below to reset your password. This link expires in 30 minutes.</p>
        <p><a href="${resetUrl}" style="display:inline-block;background:#102033;color:#fff;padding:12px 18px;text-decoration:none">Reset password</a></p>
        <p>${resetUrl}</p>
      </div>
    `,
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatRwf(value = 0) {
  return `RWF ${Math.round(Number(value) || 0).toLocaleString('en-US')}`;
}

function bookingText(booking, venue) {
  return [
    `Confirmation: ${booking.confirmationNumber}`,
    `Venue: ${booking.venueName}`,
    `Location: ${booking.venueLocation}`,
    venue?.latitude && venue?.longitude ? `Coordinates: ${venue.latitude}, ${venue.longitude}` : '',
    `Date: ${booking.date}`,
    `Time: ${booking.startTime} for ${booking.durationHours} hours`,
    `Guests: ${booking.guestCount}`,
    `Status: ${String(booking.status || '').replace(/_/g, ' ')}`,
    `Payment: ${String(booking.paymentStatus || '').replace(/_/g, ' ')}`,
    `Total: ${formatRwf(booking.totals?.total)}`,
    `Paid: ${formatRwf(booking.amountPaid)}`,
    `Balance: ${formatRwf(booking.balanceRemaining)}`,
  ].filter(Boolean).join('\n');
}

function bookingHtml(booking, venue, audience) {
  const mapUrl = venue?.latitude && venue?.longitude
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${venue.latitude},${venue.longitude}`)}`
    : '';

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#102033">
      <h2>${audience === 'owner' ? 'New venue booking received' : 'Your booking is confirmed'}</h2>
      <p><strong>Confirmation:</strong> ${escapeHtml(booking.confirmationNumber)}</p>
      <p><strong>Venue:</strong> ${escapeHtml(booking.venueName)}</p>
      <p><strong>Customer:</strong> ${escapeHtml(booking.customerName)} (${escapeHtml(booking.customerEmail)})</p>
      <p><strong>Date and time:</strong> ${escapeHtml(booking.date)} at ${escapeHtml(booking.startTime)} for ${escapeHtml(booking.durationHours)} hours</p>
      <p><strong>Guests:</strong> ${escapeHtml(booking.guestCount)}</p>
      <p><strong>Total:</strong> ${formatRwf(booking.totals?.total)}<br>
      <strong>Paid:</strong> ${formatRwf(booking.amountPaid)}<br>
      <strong>Balance:</strong> ${formatRwf(booking.balanceRemaining)}</p>
      ${mapUrl ? `<p><a href="${mapUrl}" style="display:inline-block;background:#102033;color:#fff;padding:12px 18px;text-decoration:none">Navigate to venue</a></p>` : ''}
    </div>
  `;
}

async function sendBookingConfirmation({ booking, venue }) {
  const recipients = [
    booking.customerEmail && {
      to: booking.customerEmail,
      subject: `Booking confirmed: ${booking.venueName}`,
      text: `Hello ${booking.customerName || 'there'},\n\nYour venue booking is confirmed.\n\n${bookingText(booking, venue)}\n\nSmart Event Venue`,
      html: bookingHtml(booking, venue, 'customer'),
    },
    venue?.email && {
      to: venue.email,
      subject: `New booking: ${booking.venueName}`,
      text: `Hello ${venue.contactPerson || 'Venue owner'},\n\nA customer booking has been confirmed.\n\n${bookingText(booking, venue)}\n\nSmart Event Venue`,
      html: bookingHtml(booking, venue, 'owner'),
    },
  ].filter(Boolean);

  const results = [];
  for (const recipient of recipients) {
    results.push(await sendEmail(recipient));
  }
  return results;
}

module.exports = { getEmailStatus, isEmailConfigured, sendBookingConfirmation, sendPasswordReset, sendVerificationCode };
