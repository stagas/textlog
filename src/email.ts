export async function sendPasswordReset(email: string, resetUrl: string) {
  const apiKey = Bun.env.RESEND_API_KEY
  const from = Bun.env.EMAIL_FROM
  if (!apiKey || !from) throw new Error('RESEND_API_KEY and EMAIL_FROM must be configured')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Reset your root.mx password',
      text: `Use this link to reset your root.mx password:\n\n${resetUrl}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
      html: `<p>Use the link below to reset your root.mx password.</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in one hour. If you did not request it, you can ignore this email.</p>`,
    }),
  })
  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${await response.text()}`)
}
