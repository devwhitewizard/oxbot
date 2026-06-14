const nodemailer = require('nodemailer');
const chalk      = require('chalk');

const SITE_URL = process.env.SITE_URL || 'http://oxbot.name.ng';

const TICKET_CATEGORIES = {
    bot_not_working: '🤖 Bot Not Working',
    bot_disconnecting: '🔌 Bot Disconnecting',
    pairing_issue: '📱 Pairing Issue',
    deposit_issue: '💰 Deposit Issue',
    pro_activation: '👑 Pro Activation',
    account_issue: '👤 Account Issue',
    referral_coins: '🎁 Referral Coins',
    other: '❓ Other'
};

const mailer = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE !== 'false' && (parseInt(process.env.SMTP_PORT) === 465 || !process.env.SMTP_PORT),
    auth: {
        user: process.env.SMTP_USER || 'oxbot18@gmail.com',
        pass: process.env.SMTP_PASS || 'tfyr tuta igvg uqlb',
    },
});

mailer.verify((err) => {
    if (err) console.error(chalk.red('❌ Mailer error:'), err.message);
    else     console.log(chalk.green('✅ Mailer ready → noreply@oxbot.name.ng'));
});

async function sendVerificationEmail(toEmail, name, token) {
    const link = `${SITE_URL}/verify-email?token=${token}`;
    console.log(chalk.cyan(`[EMAIL VERIFY] Verification link for ${name} (${toEmail}): ${link}`));

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Verify your OxBot email</title>
  <style>
    body{margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif}
    .wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .header{background:#16a34a;padding:32px 40px;text-align:center}
    .header h1{color:#fff;margin:0;font-size:26px;font-weight:800;letter-spacing:-.5px}
    .header p{color:rgba(255,255,255,.8);margin:6px 0 0;font-size:14px}
    .body{padding:36px 40px}
    .body h2{margin:0 0 12px;font-size:20px;color:#0f172a}
    .body p{color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px}
    .btn{display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:700;font-size:16px;letter-spacing:.2px}
    .btn:hover{background:#15803d}
    .notice{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;margin-top:24px;font-size:13px;color:#64748b;line-height:1.5}
    .footer{padding:20px 40px;text-align:center;font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>🤖 OxBot</h1>
      <p>WhatsApp Bot Platform</p>
    </div>
    <div class="body">
      <h2>Hi ${name}, confirm your email 👋</h2>
      <p>Thanks for signing up! Click the button below to verify your email address and activate your OxBot account.</p>
      <p style="text-align:center"><a href="${link}" class="btn">✅ Verify My Email</a></p>
      <div class="notice">
        <strong>This link expires in 24 hours.</strong><br>
        If you didn't create an account on OxBot, you can safely ignore this email.
      </div>
    </div>
    <div class="footer">© ${new Date().getFullYear()} OxBot · <a href="${SITE_URL}" style="color:#16a34a;text-decoration:none">${SITE_URL.replace(/^https?:\/\//, '')}</a></div>
  </div>
</body>
</html>`;

    await mailer.sendMail({
        from:    '"OxBot" <noreply@oxbot.name.ng>',
        to:      toEmail,
        subject: '✅ Verify your OxBot account',
        html,
        text: `Hi ${name},\n\nVerify your OxBot account by clicking this link:\n${link}\n\nThis link expires in 24 hours.\n\nIf you didn't sign up, ignore this email.`,
    });
}

async function sendTicketNotificationToSupport(user, ticketNumber, category, subject, message) {
    const categoryLabel = TICKET_CATEGORIES[category] || category;
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>New Support Ticket #${ticketNumber}</title>
  <style>
    body{margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif}
    .wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .header{background:#3b82f6;padding:28px 36px}
    .header h1{color:#fff;margin:0;font-size:22px;font-weight:800}
    .body{padding:32px 36px}
    .info-grid{display:grid;grid-template-columns:120px 1fr;gap:12px;margin:20px 0;background:#f8fafc;padding:16px;border-radius:10px}
    .info-label{font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
    .info-value{font-size:14px;color:#0f172a;font-weight:500}
    .message-box{background:#f0f9ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;margin:20px 0;font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap}
    .actions{margin-top:24px;text-align:center}
    .btn{display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px}
    .btn:hover{background:#2563eb}
    .footer{padding:16px 36px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>🎫 New Support Ticket</h1>
    </div>
    <div class="body">
      <div class="info-grid">
        <div class="info-label">Ticket #</div>
        <div class="info-value" style="color:#3b82f6;font-weight:700">${ticketNumber}</div>
        <div class="info-label">Category</div>
        <div class="info-value">${categoryLabel}</div>
        <div class="info-label">Subject</div>
        <div class="info-value">${subject}</div>
        <div class="info-label">User</div>
        <div class="info-value">${user.name} (@${user.username})</div>
        <div class="info-label">Email</div>
        <div class="info-value">${user.email}</div>
        <div class="info-label">Phone</div>
        <div class="info-value">${user.phone || 'N/A'}</div>
      </div>
      <div style="font-size:13px;font-weight:600;color:#475569;margin-bottom:8px">Message:</div>
      <div class="message-box">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      <div class="actions">
        <a href="${SITE_URL}/admin" class="btn">Open in Admin Panel →</a>
      </div>
    </div>
    <div class="footer">© ${new Date().getFullYear()} OxBot Support System</div>
  </div>
</body>
</html>`;

    await mailer.sendMail({
        from:    '"OxBot Support" <noreply@oxbot.name.ng>',
        to:      'support@oxbot.name.ng',
        subject: `[New Ticket] #${ticketNumber} - ${subject}`,
        html,
        text:    `New ticket #${ticketNumber}\nCategory: ${categoryLabel}\nSubject: ${subject}\nUser: ${user.name} (@${user.username})\nEmail: ${user.email}\n\nMessage:\n${message}`,
    });
}

async function sendReplyNotification(ticket, sender, message, senderType) {
    if (senderType !== 'user') return;
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Ticket Reply #${ticket.ticket_number}</title>
  <style>
    body{margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif}
    .wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .header{background:#22c55e;padding:28px 36px}
    .header h1{color:#fff;margin:0;font-size:20px;font-weight:800}
    .body{padding:32px 36px}
    .meta{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin-bottom:20px;font-size:13px}
    .meta strong{color:#16a34a}
    .message-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap}
    .actions{margin-top:24px;text-align:center}
    .btn{display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px}
    .footer{padding:16px 36px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>💬 User Reply</h1>
    </div>
    <div class="body">
      <div class="meta">
        <strong>Ticket #${ticket.ticket_number}</strong> — ${ticket.subject}<br>
        <span style="color:#64748b">Reply from: ${sender.name} (@${sender.username})</span>
      </div>
      <div class="message-box">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      <div class="actions">
        <a href="${SITE_URL}/admin" class="btn">View Ticket →</a>
      </div>
    </div>
    <div class="footer">© ${new Date().getFullYear()} OxBot Support System</div>
  </div>
</body>
</html>`;

    await mailer.sendMail({
        from:    '"OxBot Support" <noreply@oxbot.name.ng>',
        to:      'noreply@oxbot.name.ng',
        subject: `[Reply] #${ticket.ticket_number} - ${ticket.subject}`,
        html,
        text:    `User reply to #${ticket.ticket_number}\nFrom: ${sender.name} (@${sender.username})\n\n${message}`,
    });
}

async function sendAdminReplyToUser(ticket, user, message) {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Support Reply - Ticket #${ticket.ticket_number}</title>
  <style>
    body{margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif}
    .wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .header{background:#16a34a;padding:28px 36px}
    .header h1{color:#fff;margin:0;font-size:20px;font-weight:800}
    .body{padding:32px 36px}
    .meta{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin-bottom:20px;font-size:13px}
    .message-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap}
    .actions{margin-top:24px;text-align:center}
    .btn{display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px}
    .btn:hover{background:#15803d}
    .footer{padding:16px 36px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>📩 New Support Reply</h1>
    </div>
    <div class="body">
      <div class="meta">
        <strong>Ticket #${ticket.ticket_number}</strong> — ${ticket.subject}<br>
        <span style="color:#64748b">Status: ${ticket.status.toUpperCase()}</span>
      </div>
      <div style="font-size:13px;font-weight:600;color:#475569;margin-bottom:8px">Support Team replied:</div>
      <div class="message-box">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      <div class="actions">
        <a href="${SITE_URL}/dashboard" class="btn">View in Dashboard →</a>
      </div>
      <p style="margin-top:20px;font-size:12px;color:#64748b;text-align:center">
        You can reply directly from your dashboard or email us at <a href="mailto:noreply@oxbot.name.ng" style="color:#16a34a">noreply@oxbot.name.ng</a>
      </p>
    </div>
    <div class="footer">© ${new Date().getFullYear()} OxBot · <a href="${SITE_URL}" style="color:#16a34a">${SITE_URL.replace(/^https?:\/\//, '')}</a></div>
  </div>
</body>
</html>`;

    await mailer.sendMail({
        from:    '"OxBot Support" <noreply@oxbot.name.ng>',
        to:      user.email,
        subject: `[Reply] Ticket #${ticket.ticket_number} - ${ticket.subject}`,
        html,
        text:    `Support has replied to your ticket #${ticket.ticket_number}\n\n${message}\n\nView in dashboard: ${SITE_URL}/dashboard`,
    });
}

async function sendResetCodeEmail(toEmail, name, code) {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Reset Password - OxBot</title>
  <style>
    body{margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif}
    .wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .header{background:#16a34a;padding:32px 40px;text-align:center}
    .header h1{color:#fff;margin:0;font-size:24px;font-weight:800}
    .body{padding:36px 40px}
    .body h2{margin:0 0 8px;font-size:20px;color:#0f172a}
    .body p{color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px}
    .code-box{background:#f0fdf4;border:2px dashed #16a34a;border-radius:14px;padding:24px;text-align:center;margin:24px 0}
    .code-label{font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
    .code-value{font-size:42px;font-weight:800;color:#16a34a;letter-spacing:12px;font-family:'Courier New',monospace}
    .code-expiry{font-size:12px;color:#f59e0b;margin-top:12px}
    .warning-box{background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-top:20px;font-size:13px;color:#92400e;line-height:1.5}
    .footer{padding:20px 40px;text-align:center;font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9}
    a{color:#16a34a}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>🔐 Password Reset</h1>
    </div>
    <div class="body">
      <h2>Hi ${name},</h2>
      <p>We received a request to reset your OxBot password. Use the code below to proceed:</p>
      
      <div class="code-box">
        <div class="code-label">Verification Code</div>
        <div class="code-value">${code}</div>
        <div class="code-expiry">⏱ This code expires in 10 minutes</div>
      </div>
      
      <div class="warning-box">
        <strong>⚠️ Important:</strong><br>
        • Do not share this code with anyone.<br>
        • If you didn't request this, ignore this email — your password is safe.<br>
        • This code cannot be used to log in, only to reset your password.
      </div>
      
      <p style="margin-top:20px;text-align:center">
        <a href="${SITE_URL}/forgot-password" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 32px;border-radius:10px;font-weight:600;font-size:15px">Enter Code →</a>
      </p>
    </div>
    <div class="footer">© ${new Date().getFullYear()} OxBot · <a href="${SITE_URL}">${SITE_URL.replace(/^https?:\/\//, '')}</a></div>
  </div>
</body>
</html>`;

    await mailer.sendMail({
        from:    '"OxBot" <noreply@oxbot.name.ng>',
        to:      toEmail,
        subject: `🔐 Password Reset Code: ${code}`,
        html,
        text:    `Hi ${name},\n\nYour OxBot password reset code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
    });
}

module.exports = {
    mailer,
    TICKET_CATEGORIES,
    sendVerificationEmail,
    sendTicketNotificationToSupport,
    sendReplyNotification,
    sendAdminReplyToUser,
    sendResetCodeEmail
};
