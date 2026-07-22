/**
 * @file oxbot/mailer.js
 * @description Premium, anti-spam email service for OxBot using Gmail.
 */

const nodemailer = require('nodemailer');
const chalk = require('chalk');

const SITE_URL = 'https://oxbot.name.ng';
const SUPPORT_EMAIL = 'support@oxbot.name.ng';

// ── Gmail SMTP Setup ──────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: 'oxbot18@gmail.com',
        pass: 'tfyr tuta igvg uqlb',
    },
    tls: {
        rejectUnauthorized: false,
    },
});

transporter.verify((err) => {
    if (err) {
        console.error(chalk.red('❌ Mail Error:'), err.message);
    } else {
        console.log(chalk.green('✅ Premium Mailer ready → oxbot18@gmail.com'));
    }
});

// ── Safe Send Helper (Anti-Spam Headers) ──────────────────────────────────────

async function sendEmail(to, subject, html, text) {
    try {
        await transporter.sendMail({
            from: '"OxBot" <oxbot18@gmail.com>',
            replyTo: 'oxbot18@gmail.com',
            to,
            subject: subject,
            html,
            text,
            headers: {
                'X-Priority': '1',
                'X-Mailer': 'OxBot System',
                'List-Unsubscribe': `<mailto:oxbot18@gmail.com?subject=unsubscribe>`,
            }
        });
        console.log(chalk.gray(`📧 Sent: ${subject} → ${to}`));
        return true;
    } catch (err) {
        console.error(chalk.red(`❌ Failed: ${subject}`), err.message);
        return false;
    }
}

// ── Ticket Categories ─────────────────────────────────────────────────────────

const TICKET_CATEGORIES = {
    bot_not_working: 'Bot Not Working',
    bot_disconnecting: 'Bot Disconnecting',
    pairing_issue: 'Pairing Issue',
    deposit_issue: 'Deposit Issue',
    pro_activation: 'Pro Activation',
    account_issue: 'Account Issue',
    referral_coins: 'Referral Coins',
    other: 'Other',
};

// ── Verification Email ────────────────────────────────────────────────────────

async function sendVerificationEmail(toEmail, name, token) {
    const link = `${SITE_URL}/verify-email?token=${token}`;
    console.log(chalk.cyan(`[EMAIL] Verify: ${name} → ${toEmail}`));

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;padding:0;background-color:#f0f2f5;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrapper{max-width:600px;margin:40px auto;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.08)}
.header{background:linear-gradient(135deg, #059669 0%, #10b981 100%);padding:48px 40px;text-align:center}
.logo{color:#ffffff;font-size:28px;font-weight:800;margin:0;letter-spacing:-0.5px}
.subtitle{color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;font-weight:500;letter-spacing:0.5px;text-transform:uppercase}
.content{padding:48px 40px}
.main-title{font-size:24px;font-weight:700;color:#111827;margin:0 0 16px;line-height:1.3}
.text{font-size:16px;color:#4b5563;line-height:1.7;margin:0 0 32px}
.btn-container{text-align:center;margin:40px 0}
.button{display:inline-block;background-color:#111827;color:#ffffff!important;text-decoration:none!important;padding:16px 40px;border-radius:12px;font-weight:600;font-size:16px;box-shadow:0 10px 15px -3px rgba(17, 24, 39, 0.2);transition:all 0.2s}
.divider{height:1px;background-color:#f3f4f6;margin:32px 0}
.notice-box{background-color:#f9fafb;border-left:4px solid #d1d5db;border-radius:0 8px 8px 0;padding:16px 20px}
.notice-text{font-size:14px;color:#6b7280;line-height:1.6;margin:0}
.footer{padding:32px 40px;text-align:center;border-top:1px solid #f3f4f6}
.footer-text{font-size:13px;color:#9ca3af;margin:0}
.footer-link{color:#059669;text-decoration:none;font-weight:500}
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1 class="logo">OxBot</h1>
    <p class="subtitle">WhatsApp Automation Platform</p>
  </div>
  <div class="content">
    <h2 class="main-title">Welcome, ${name}!</h2>
    <p class="text">Thank you for creating your account. To get started and deploy your first bot, please verify your email address by clicking the button below.</p>
    <div class="btn-container">
      <a href="${link}" class="button">Verify My Email Address</a>
    </div>
    <div class="divider"></div>
    <div class="notice-box">
      <p class="notice-text"><strong>Note:</strong> This verification link will expire in 24 hours for security purposes. If you did not create an account with us, you can safely ignore this email.</p>
    </div>
  </div>
  <div class="footer">
    <p class="footer-text">© ${new Date().getFullYear()} OxBot. All rights reserved.<br>Visit us: <a href="${SITE_URL}" class="footer-link">oxbot.name.ng</a></p>
  </div>
</div>
</body></html>`;

    return sendEmail(toEmail, 'Action Required: Verify your OxBot Account', html,
        `Hi ${name},\n\nVerify your account:\n${link}\n\nExpires in 24 hours.`);
}

// ── Reset Code Email ──────────────────────────────────────────────────────────

async function sendResetCodeEmail(toEmail, name, code) {
    console.log(chalk.cyan(`[EMAIL] Reset: ${toEmail} → ${code}`));

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;padding:0;background-color:#f0f2f5;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrapper{max-width:600px;margin:40px auto;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.08)}
.header{background:linear-gradient(135deg, #111827 0%, #1f2937 100%);padding:48px 40px;text-align:center}
.logo{color:#ffffff;font-size:28px;font-weight:800;margin:0}
.subtitle{color:rgba(255,255,255,0.7);margin:8px 0 0;font-size:14px;font-weight:500;text-transform:uppercase;letter-spacing:1px}
.content{padding:48px 40px}
.main-title{font-size:24px;font-weight:700;color:#111827;margin:0 0 16px}
.text{font-size:16px;color:#4b5563;line-height:1.7;margin:0 0 32px}
.code-card{background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:16px;padding:40px;text-align:center;margin:32px 0}
.code-label{font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1.5px;font-weight:600;margin:0 0 16px}
.code-value{font-size:48px;font-weight:800;color:#111827;letter-spacing:14px;font-family:'Courier New',Courier,monospace;margin:0}
.code-timer{font-size:13px;color:#f59e0b;margin:16px 0 0;font-weight:500}
.security-box{background-color:#fefce8;border:1px solid #fde68a;border-radius:12px;padding:20px;margin-top:32px}
.security-text{font-size:14px;color:#92400e;line-height:1.6;margin:0}
.footer{padding:32px 40px;text-align:center;border-top:1px solid #f3f4f6}
.footer-text{font-size:13px;color:#9ca3af;margin:0}
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1 class="logo">OxBot Security</h1>
    <p class="subtitle">Password Reset</p>
  </div>
  <div class="content">
    <h2 class="main-title">Hi ${name},</h2>
    <p class="text">We received a request to reset the password associated with this email address. Enter the code below to proceed.</p>
    
    <div class="code-card">
      <p class="code-label">Security Code</p>
      <h3 class="code-value">${code}</h3>
      <p class="code-timer">This code expires in 10 minutes</p>
    </div>

    <div class="security-box">
      <p class="security-text"><strong>Security Notice:</strong> If you did not request a password reset, please ignore this email. Your account remains secure and no changes have been made.</p>
    </div>
  </div>
  <div class="footer">
    <p class="footer-text">© ${new Date().getFullYear()} OxBot. All rights reserved.</p>
  </div>
</div>
</body></html>`;

    return sendEmail(toEmail, `Your OxBot Reset Code: ${code}`, html,
        `Hi ${name},\n\nReset code: ${code}\n\nExpires in 10 minutes.`);
}

// ── Ticket Notification to Support ─────────────────────────────────────────────

async function sendTicketNotificationToSupport(user, ticketNumber, category, subject, message) {
    const cat = TICKET_CATEGORIES[category] || category;
    const safe = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
body{margin:0;padding:0;background-color:#f0f2f5;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif}
.wrapper{max-width:620px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.08)}
.header{background:linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);padding:36px 40px}
.header h1{color:#fff;margin:0;font-size:22px;font-weight:700}
.content{padding:40px}
.info-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin:0 0 24px}
.info-row{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #f1f5f9;font-size:14px}
.info-row:last-child{border-bottom:none}
.info-label{color:#64748b;font-weight:500}
.info-value{color:#0f172a;font-weight:600;text-align:right;max-width:60%;word-wrap:break-word}
.msg-card{background:#fff;border:1px solid #e2e8f0;border-left:4px solid #3b82f6;border-radius:4px;padding:20px;font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap;margin-bottom:24px}
.btn{display:inline-block;background:#2563eb;color:#fff!important;text-decoration:none!important;padding:12px 32px;border-radius:10px;font-weight:600;font-size:14px;box-shadow:0 4px 6px -1px rgba(37,99,235,0.2)}
.footer{padding:24px 40px;text-align:center;border-top:1px solid #f3f4f6;font-size:12px;color:#9ca3af}
</style>
</head>
<body>
<div class="wrapper">
  <div class="header"><h1>New Support Ticket</h1></div>
  <div class="content">
    <div class="info-card">
      <div class="info-row"><span class="info-label">Ticket ID</span><span class="info-value" style="color:#2563eb">#${ticketNumber}</span></div>
      <div class="info-row"><span class="info-label">Category</span><span class="info-value">${cat}</span></div>
      <div class="info-row"><span class="info-label">Subject</span><span class="info-value">${subject}</span></div>
      <div class="info-row"><span class="info-label">User</span><span class="info-value">${user.name} (@${user.username})</span></div>
      <div class="info-row"><span class="info-label">Email</span><span class="info-value">${user.email}</span></div>
      <div class="info-row"><span class="info-label">Phone</span><span class="info-value">${user.phone || 'N/A'}</span></div>
    </div>
    <div class="msg-card">${safe}</div>
    <div style="text-align:center"><a href="${SITE_URL}/admin" class="btn">Open Admin Panel</a></div>
  </div>
  <div class="footer">© ${new Date().getFullYear()} OxBot System</div>
</div>
</body></html>`;

    return sendEmail(SUPPORT_EMAIL, `[New Ticket] #${ticketNumber} - ${subject}`, html,
        `New ticket #${ticketNumber}\nBy: ${user.name}\n\n${message}`);
}

// ── User Reply Notification ───────────────────────────────────────────────────

async function sendReplyNotification(ticket, sender, message, senderType) {
    if (senderType !== 'user') return true;
    const safe = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
body{margin:0;padding:0;background-color:#f0f2f5;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif}
.wrapper{max-width:620px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.08)}
.header{background:linear-gradient(135deg, #059669 0%, #10b981 100%);padding:36px 40px}
.header h1{color:#fff;margin:0;font-size:20px;font-weight:700}
.content{padding:40px}
.meta{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin-bottom:24px;font-size:14px;color:#065f46}
.msg{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap}
.btn{display:inline-block;background:#111827;color:#fff!important;text-decoration:none!important;padding:12px 32px;border-radius:10px;font-weight:600;font-size:14px;margin-top:24px;box-shadow:0 4px 6px -1px rgba(17,24,39,0.2)}
.footer{padding:24px 40px;text-align:center;border-top:1px solid #f3f4f6;font-size:12px;color:#9ca3af}
</style>
</head>
<body>
<div class="wrapper">
  <div class="header"><h1>User Reply Received</h1></div>
  <div class="content">
    <div class="meta"><strong>#${ticket.ticket_number}</strong> — ${ticket.subject}<br>From: ${sender.name} (@${sender.username})</div>
    <div class="msg">${safe}</div>
    <div style="text-align:center"><a href="${SITE_URL}/admin" class="btn">View Ticket</a></div>
  </div>
  <div class="footer">© ${new Date().getFullYear()} OxBot System</div>
</div>
</body></html>`;

    return sendEmail(SUPPORT_EMAIL, `[Reply] #${ticket.ticket_number} - ${ticket.subject}`, html,
        `Reply from ${sender.name}:\n${message}`);
}

// ── Admin Reply to User ───────────────────────────────────────────────────────

async function sendAdminReplyToUser(ticket, user, message) {
    const safe = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
body{margin:0;padding:0;background-color:#f0f2f5;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif}
.wrapper{max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.08)}
.header{background:linear-gradient(135deg, #059669 0%, #10b981 100%);padding:48px 40px;text-align:center}
.logo{color:#fff;font-size:28px;font-weight:800;margin:0}
.content{padding:48px 40px}
.main-title{font-size:20px;font-weight:700;color:#111827;margin:0 0 16px}
.meta{background:#f0fdf4;border-left:4px solid #059669;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:32px;font-size:14px;color:#065f46}
.msg{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;font-size:15px;color:#334155;line-height:1.7;white-space:pre-wrap}
.btn-container{text-align:center;margin-top:32px}
.btn{display:inline-block;background:#111827;color:#fff!important;text-decoration:none!important;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;box-shadow:0 10px 15px -3px rgba(17, 24, 39, 0.2)}
.footer{padding:32px 40px;text-align:center;border-top:1px solid #f3f4f6;font-size:13px;color:#9ca3af}
.footer-link{color:#059669;text-decoration:none}
</style>
</head>
<body>
<div class="wrapper">
  <div class="header"><h1 class="logo">OxBot Support</h1></div>
  <div class="content">
    <h2 class="main-title">Update on your request</h2>
    <div class="meta"><strong>Ticket #${ticket.ticket_number}</strong> — ${ticket.subject}<br>Status: ${ticket.status.toUpperCase()}</div>
    <div class="msg">${safe}</div>
    <div class="btn-container">
      <a href="${SITE_URL}/dashboard" class="btn">View in Dashboard</a>
    </div>
  </div>
  <div class="footer">
    <p style="margin:0 0 8px">You can reply directly from your dashboard.</p>
    <p style="margin:0">© ${new Date().getFullYear()} OxBot. All rights reserved.</p>
  </div>
</div>
</body></html>`;

    return sendEmail(user.email, `[Reply] Ticket #${ticket.ticket_number} - ${ticket.subject}`, html,
        `Support replied:\n${message}\n\nView: ${SITE_URL}/dashboard`);
}

// ── Export ────────────────────────────────────────────────────────────────────

module.exports = {
    mailer: transporter,
    TICKET_CATEGORIES,
    sendVerificationEmail,
    sendResetCodeEmail,
    sendTicketNotificationToSupport,
    sendReplyNotification,
    sendAdminReplyToUser,
};
