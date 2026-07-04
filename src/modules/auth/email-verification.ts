import { getResend, FROM_ADDRESS } from '../../lib/email/index.ts'

export interface EmailVerificationParams {
  to: string
  token: string
}

function getVerifyUrl(token: string): string {
  const apiBase = process.env.GOOGLE_REDIRECT_URI
    ? new URL(process.env.GOOGLE_REDIRECT_URI).origin
    : `http://localhost:${process.env.PORT ?? 3001}`

  return `${apiBase}/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`
}

export async function sendEmailVerification(params: EmailVerificationParams): Promise<void> {
  const verifyUrl = getVerifyUrl(params.token)

  if (!process.env.RESEND_API_KEY) {
    console.log(`[auth] Email verification link for ${params.to}: ${verifyUrl}`)
    return
  }

  await getResend().emails.send({
    from: FROM_ADDRESS,
    to: params.to,
    subject: 'Confirm your Xenysis account',
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:40px 20px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fafafa;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#111111;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;">
          <tr>
            <td style="padding-bottom:24px;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#ffffff;">Confirm your email</h1>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:28px;">
              <p style="margin:0;font-size:14px;line-height:1.7;color:#a1a1aa;">
                Click the button below to verify your Xenysis account and start building.
              </p>
            </td>
          </tr>
          <tr>
            <td>
              <a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#4ffab0;color:#000000;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;">
                Confirm email
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
    text: `Confirm your Xenysis account: ${verifyUrl}`,
  })
}
