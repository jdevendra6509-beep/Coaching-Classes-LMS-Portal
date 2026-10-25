import type { MailMessage } from "./mail.service.js";

export function inviteEmail(to: string, name: string, instituteName: string, link: string): MailMessage {
  return {
    to,
    subject: `Your ${instituteName} account is ready`,
    text:
      `Hi ${name},\n\nAn account has been created for you on ${instituteName}'s learning portal.\n` +
      `Set your password here (the link is valid for 7 days):\n\n${link}\n\n` +
      `If you weren't expecting this, you can ignore this email.`,
  };
}

export function accessGrantedEmail(to: string, name: string, instituteName: string, link: string): MailMessage {
  return {
    to,
    subject: `You now have access to ${instituteName}`,
    text: `Hi ${name},\n\nYou have been given access to ${instituteName}. Sign in with your existing password:\n\n${link}`,
  };
}

export function passwordResetEmail(to: string, name: string, link: string): MailMessage {
  return {
    to,
    subject: "Reset your password",
    text:
      `Hi ${name},\n\nUse this link to set a new password (valid for 1 hour):\n\n${link}\n\n` +
      `If you didn't ask for this, ignore this email; your password is unchanged.`,
  };
}
