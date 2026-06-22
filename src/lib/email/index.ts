import { Resend } from 'resend'

let _resend: Resend | null = null

function getResend(): Resend {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not set — email sending is unavailable')
    }
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}

const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'Xenysis <noreply@xenysis.app>'

export interface WaitlistConfirmationParams {
  to: string
  startupName: string
  joinedAt: Date
}

export async function sendWaitlistConfirmation(params: WaitlistConfirmationParams): Promise<void> {
  const { to, startupName, joinedAt } = params

  const formattedDate = joinedAt.toLocaleDateString('en-US', {
    year:  'numeric',
    month: 'long',
    day:   'numeric',
  })

  await getResend().emails.send({
    from:    FROM_ADDRESS,
    to,
    subject: "You're on the Workspace Generation Early Access List",
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Workspace Generation Early Access</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fafafa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#111111;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;">

          <!-- Logo / wordmark -->
          <tr>
            <td style="padding-bottom:32px;">
              <img src="https://xenysis.com/logo.png" alt="Xenysis" width="28" height="28" style="display:inline-block;vertical-align:middle;margin-right:8px;border-radius:6px;" />
              <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;vertical-align:middle;">Xenysis</span>
            </td>
          </tr>

          <!-- Badge -->
          <tr>
            <td style="padding-bottom:20px;">
              <span style="display:inline-block;padding:4px 10px;background:rgba(79,250,176,0.1);border:1px solid rgba(79,250,176,0.2);border-radius:20px;font-size:11px;font-weight:600;color:#4ffab0;letter-spacing:0.04em;">
                Early Access
              </span>
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td style="padding-bottom:12px;">
              <h1 style="margin:0;font-size:24px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;">
                You&rsquo;re on the list.
              </h1>
            </td>
          </tr>

          <!-- Body copy -->
          <tr>
            <td style="padding-bottom:28px;">
              <p style="margin:0;font-size:14px;line-height:1.7;color:#a1a1aa;">
                Thank you for joining the Workspace Generation early access program.
                We&rsquo;ll notify you as soon as Workspace Generation becomes available for your startup.
              </p>
            </td>
          </tr>

          <!-- Startup detail card -->
          <tr>
            <td style="padding-bottom:28px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:20px;">
                <tr>
                  <td>
                    <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#52525b;">Startup</p>
                    <p style="margin:0 0 16px 0;font-size:16px;font-weight:600;color:#ffffff;">${startupName}</p>
                    <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#52525b;">Registered</p>
                    <p style="margin:0;font-size:14px;color:#a1a1aa;">${formattedDate}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- What's coming -->
          <tr>
            <td style="padding-bottom:12px;">
              <p style="margin:0 0 12px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:#52525b;">
                Future capabilities include
              </p>
              <table cellpadding="0" cellspacing="0">
                ${[
                  'Product Requirements',
                  'Technical Architecture',
                  'Database Design',
                  'API Specifications',
                  'UI Generation',
                  'Interactive Product Preview',
                  'Deployment Assets',
                ].map((f) => `
                <tr>
                  <td style="padding-bottom:8px;">
                    <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#4ffab0;margin-right:8px;vertical-align:middle;"></span>
                    <span style="font-size:13px;color:#d4d4d8;">${f}</span>
                  </td>
                </tr>`).join('')}
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:24px 0;">
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.06);" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td>
              <p style="margin:0;font-size:12px;color:#52525b;line-height:1.6;">
                Thank you for helping shape Xenysis.<br />
                We&rsquo;ll be in touch soon.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
    text: `
You're on the Workspace Generation Early Access List

Thank you for joining the Workspace Generation early access program.

Startup: ${startupName}
Registered: ${formattedDate}

We'll notify you as soon as Workspace Generation becomes available.

Future capabilities include:
- Product Requirements
- Technical Architecture
- Database Design
- API Specifications
- UI Generation
- Interactive Product Preview
- Deployment Assets

Thank you for helping shape Xenysis.
    `.trim(),
  })
}

export interface WaitlistActivationParams {
  to: string
  startupName: string
}

export async function sendWaitlistActivation(params: WaitlistActivationParams): Promise<void> {
  const { to, startupName } = params

  await getResend().emails.send({
    from:    FROM_ADDRESS,
    to,
    subject: 'Workspace Generation is now available for your startup',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fafafa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#111111;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;">
          <tr>
            <td style="padding-bottom:32px;">
              <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;">Xenysis</span>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:20px;">
              <span style="display:inline-block;padding:4px 10px;background:rgba(79,250,176,0.1);border:1px solid rgba(79,250,176,0.2);border-radius:20px;font-size:11px;font-weight:600;color:#4ffab0;letter-spacing:0.04em;">
                Now Available
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:12px;">
              <h1 style="margin:0;font-size:24px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;">
                Workspace Generation is live.
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:28px;">
              <p style="margin:0;font-size:14px;line-height:1.7;color:#a1a1aa;">
                Workspace Generation is now available for <strong style="color:#ffffff;">${startupName}</strong>.
                Log in to Xenysis to start generating your workspace.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:28px;">
              <a href="https://app.xenysis.app" style="display:inline-block;padding:12px 24px;background:#4ffab0;color:#000000;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;">
                Open Xenysis
              </a>
            </td>
          </tr>
          <tr>
            <td>
              <p style="margin:0;font-size:12px;color:#52525b;">Thank you for being an early adopter.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
    text: `Workspace Generation is now available for ${startupName}.\n\nLog in to Xenysis to start: https://app.xenysis.app`,
  })
}
