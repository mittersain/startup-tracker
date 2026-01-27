import nodemailer from 'nodemailer';
import prisma from '../utils/prisma.js';

interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;
  organizationId: string;
  userId: string;
  startupId?: string;
}

export class EmailService {
  /**
   * Send an email using the organization's configured SMTP settings
   */
  async sendEmail(options: SendEmailOptions): Promise<void> {
    const { to, subject, body, organizationId, userId, startupId } = options;

    // Get organization's email settings
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });

    const settings = org?.settings as Record<string, unknown> | null;
    const emailConfig = settings?.emailInbox as {
      host: string;
      port: number;
      user: string;
      password: string;
      tls: boolean;
    } | undefined;

    if (!emailConfig) {
      throw new Error('Email not configured. Please configure email settings first.');
    }

    // Create transporter using the same IMAP credentials for SMTP
    // Gmail SMTP uses the same credentials
    const smtpHost = emailConfig.host.replace('imap.', 'smtp.');
    const smtpPort = 587; // Standard SMTP submission port

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: false, // Use STARTTLS
      auth: {
        user: emailConfig.user,
        pass: emailConfig.password,
      },
    });

    // Send the email
    const info = await transporter.sendMail({
      from: `"Agent Jarvis" <${emailConfig.user}>`,
      to,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>'),
    });

    console.log(`[EmailService] Email sent to ${to}: ${info.messageId}`);

    // Record the sent email in the database
    if (startupId) {
      await prisma.email.create({
        data: {
          organizationId,
          userId,
          startupId,
          outlookId: info.messageId || `sent-${Date.now()}`,
          subject,
          fromAddress: emailConfig.user,
          fromName: 'Agent Jarvis',
          toAddresses: [{ email: to }],
          bodyPreview: body.substring(0, 500),
          bodyHtml: body.replace(/\n/g, '<br>'),
          receivedAt: new Date(),
          direction: 'outbound',
          matchConfidence: 1.0,
          isRead: true,
        },
      });
    }
  }
}

export const emailService = new EmailService();
