const mailer = require("./mailer");

async function sendApprovalEmail(toEmail, name) {
  await mailer.sendMail({
    from: `"PDF Share" <${process.env.MAIL_USER}>`,
    to: toEmail,
    subject: "🎉 Your PDF Share Access Has Been Approved!",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#4F46E5">Welcome to PDF Share, ${name}!</h2>
        <p>Your access request has been <strong>approved</strong>.</p>
        <p>You can now log in with the password you set during registration.</p>
        <p>— The PDF Share Team</p>
      </div>
    `,
  });
}

async function sendRejectionEmail(toEmail, name) {
  await mailer.sendMail({
    from: `"PDF Share" <${process.env.MAIL_USER}>`,
    to: toEmail,
    subject: "PDF Share — Access Request Update",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#DC2626">Access Request Not Approved</h2>
        <p>Hi ${name}, unfortunately your request was not approved at this time.</p>
        <p>If you believe this is a mistake, please contact us.</p>
        <p>— The PDF Share Team</p>
      </div>
    `,
  });
}

module.exports = { sendApprovalEmail, sendRejectionEmail };