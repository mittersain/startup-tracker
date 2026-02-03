import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import pdfParse from 'pdf-parse';
import {
  buildEmailIntakePrompt,
  type ForwardedEmailContent,
  type ExtractedStartupProposal,
} from '@startup-tracker/ai-prompts';
import { aiService } from './ai.service.js';
import { scoringService } from './scoring.service.js';
import { emailService } from './email.service.js';
import prisma from '../utils/prisma.js';
import { decrypt, isEncrypted } from '../utils/encryption.js';
import { v4 as uuidv4 } from 'uuid';
import type { ScoreCategory } from '@startup-tracker/shared';

export interface InboxConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  folder?: string;
}

export interface ProcessedEmail {
  messageId: string;
  subject: string;
  from: string;
  date: Date;
  proposal?: ExtractedStartupProposal;
  startupId?: string;
  emailRecordId?: string;
  deckIds?: string[];
  error?: string;
}

export interface SyncResult {
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  decksProcessed: number;
  emailsLinked: number;
  queued: number;
  results: ProcessedEmail[];
}

export interface QueuedProposal {
  id: string;
  emailSubject: string;
  emailFrom: string;
  emailFromName?: string;
  emailDate: Date;
  emailPreview: string;
  startupName: string;
  description?: string;
  website?: string;
  founderName?: string;
  founderEmail?: string;
  askAmount?: string;
  stage?: string;
  confidence: number;
  aiReason?: string;
  status: string;
  createdAt: Date;
}

export class EmailInboxService {
  private config: InboxConfig | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;

  /**
   * Configure the inbox connection
   */
  configure(config: InboxConfig): void {
    this.config = config;
  }

  /**
   * Create an ImapFlow client
   */
  private createClient(config: InboxConfig): ImapFlow {
    // SECURITY: Decrypt password if it's encrypted
    const password = isEncrypted(config.password) ? decrypt(config.password) : config.password;

    return new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.tls,
      auth: {
        user: config.user,
        pass: password,  // Use decrypted password
      },
      logger: false,
      tls: {
        rejectUnauthorized: true,  // SECURITY: Always verify TLS certificates to prevent MITM attacks
        minVersion: 'TLSv1.2',     // Enforce modern TLS version
      },
    });
  }

  /**
   * Test the inbox connection
   */
  async testConnection(config: InboxConfig): Promise<{ success: boolean; error?: string; mailboxInfo?: { total: number; unseen: number } }> {
    const client = this.createClient(config);

    try {
      await client.connect();

      const mailbox = await client.mailboxOpen(config.folder || 'INBOX');

      // Get unseen count via status command
      const status = await client.status(config.folder || 'INBOX', { unseen: true });

      const result = {
        success: true,
        mailboxInfo: {
          total: mailbox.exists,
          unseen: status.unseen ?? 0,
        },
      };

      await client.logout();
      return result;
    } catch (error) {
      try {
        await client.logout();
      } catch {
        // Ignore logout errors
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown connection error',
      };
    }
  }

  /**
   * Fetch unread emails from the inbox
   */
  async fetchUnreadEmails(config: InboxConfig, limit = 10): Promise<ParsedMail[]> {
    const client = this.createClient(config);
    const emails: ParsedMail[] = [];

    try {
      await client.connect();
      await client.mailboxOpen(config.folder || 'INBOX');

      // Search for unseen messages
      const searchResult = await client.search({ seen: false });
      const unseenMessages = Array.isArray(searchResult) ? searchResult : [];

      if (unseenMessages.length === 0) {
        await client.logout();
        return emails;
      }

      // Get the most recent messages up to limit
      const messagesToFetch = unseenMessages.slice(-limit);

      for (const uid of messagesToFetch) {
        try {
          const message = await client.fetchOne(uid, { source: true });
          if (message && typeof message === 'object' && 'source' in message && message.source) {
            const parsed = await simpleParser(message.source as Buffer);
            emails.push(parsed);

            // Mark as seen
            await client.messageFlagsAdd(uid, ['\\Seen']);
          }
        } catch (fetchError) {
          console.error(`Failed to fetch message ${uid}:`, fetchError);
        }
      }

      await client.logout();
      return emails;
    } catch (error) {
      try {
        await client.logout();
      } catch {
        // Ignore logout errors
      }
      throw error;
    }
  }

  /**
   * Fetch recent emails from the inbox (regardless of read status)
   * Looks for emails from the last N days
   */
  async fetchRecentEmails(config: InboxConfig, limit = 50, days = 7): Promise<ParsedMail[]> {
    const client = this.createClient(config);
    const emails: ParsedMail[] = [];

    try {
      await client.connect();
      console.log(`[EmailSync] Connected to ${config.host}`);

      await client.mailboxOpen(config.folder || 'INBOX');
      console.log(`[EmailSync] Opened folder: ${config.folder || 'INBOX'}`);

      // Search for emails from the last N days
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - days);

      console.log(`[EmailSync] Searching for emails since ${sinceDate.toISOString()}`);

      const searchResult = await client.search({ since: sinceDate });
      const recentMessages = Array.isArray(searchResult) ? searchResult : [];

      console.log(`[EmailSync] Found ${recentMessages.length} emails from last ${days} days`);

      if (recentMessages.length === 0) {
        await client.logout();
        return emails;
      }

      // Get the most recent messages up to limit (take from the end which are newest)
      const messagesToFetch = recentMessages.slice(-limit);
      console.log(`[EmailSync] Fetching ${messagesToFetch.length} most recent emails`);

      for (const uid of messagesToFetch) {
        try {
          const message = await client.fetchOne(uid, { source: true });
          if (message && typeof message === 'object' && 'source' in message && message.source) {
            const parsed = await simpleParser(message.source as Buffer);
            emails.push(parsed);
          }
        } catch (fetchError) {
          console.error(`[EmailSync] Failed to fetch message ${uid}:`, fetchError);
        }
      }

      console.log(`[EmailSync] Successfully fetched ${emails.length} emails`);
      await client.logout();
      return emails;
    } catch (error) {
      console.error('[EmailSync] Error fetching emails:', error);
      try {
        await client.logout();
      } catch {
        // Ignore logout errors
      }
      throw error;
    }
  }

  /**
   * Convert ParsedMail to ForwardedEmailContent
   */
  private mailToEmailContent(mail: ParsedMail): ForwardedEmailContent {
    const fromAddress = mail.from?.value?.[0];
    const htmlContent = mail.html;
    const bodyContent = mail.text || (typeof htmlContent === 'string' ? htmlContent.replace(/<[^>]*>/g, ' ') : '') || '';

    return {
      subject: mail.subject || 'No Subject',
      body: bodyContent,
      from: fromAddress ? `${fromAddress.name || ''} <${fromAddress.address}>` : 'Unknown',
      date: mail.date?.toISOString(),
      attachmentNames: mail.attachments?.map((a) => a.filename || 'unnamed'),
    };
  }

  /**
   * Extract startup proposal from email using AI
   */
  async extractProposalFromEmail(email: ForwardedEmailContent): Promise<ExtractedStartupProposal | null> {
    if (!aiService.enabled) {
      throw new Error('AI service is not enabled. Set GEMINI_API_KEY to use email extraction.');
    }

    const prompt = buildEmailIntakePrompt(email);

    // Use the AI service's Gemini client to extract proposal
    const client = (aiService as any).client;
    const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }
      return JSON.parse(jsonMatch[0]) as ExtractedStartupProposal;
    } catch {
      console.error('Failed to parse email extraction response:', text);
      return null;
    }
  }

  /**
   * Create a startup from extracted proposal
   */
  async createStartupFromProposal(
    proposal: ExtractedStartupProposal,
    organizationId: string,
    userId: string
  ): Promise<string> {
    // Map stage string to enum value
    const stageMap: Record<string, string> = {
      'pre-seed': 'pre_seed',
      'preseed': 'pre_seed',
      'seed': 'seed',
      'series-a': 'series_a',
      'series a': 'series_a',
      'series-b': 'series_b',
      'series b': 'series_b',
      'growth': 'growth',
    };

    const stage = proposal.stage ? stageMap[proposal.stage.toLowerCase()] || 'seed' : 'seed';

    // Run AI business model analysis and generate draft reply
    let businessModelAnalysis: Record<string, unknown> | null = null;
    let draftReply: string | null = null;
    let aiSector: string | null = null;
    let aiStage = stage;

    if (aiService.enabled) {
      try {
        console.log(`[StartupCreation] Running AI analysis for ${proposal.startupName}...`);
        const analysisResult = await aiService.analyzeAndDraftReply({
          name: proposal.startupName,
          description: proposal.description,
          website: proposal.website,
          founderName: proposal.founderName,
          founderEmail: proposal.founderEmail,
          askAmount: proposal.askAmount,
          stage: proposal.stage,
          extractedData: proposal as unknown as Record<string, unknown>,
        });

        businessModelAnalysis = analysisResult.analysis as unknown as Record<string, unknown>;
        draftReply = analysisResult.draftReply;
        aiSector = analysisResult.sector;
        aiStage = analysisResult.stage || stage;
        console.log(`[StartupCreation] AI analysis complete - Sector: ${aiSector}, Stage: ${aiStage}`);
      } catch (error) {
        console.error('[StartupCreation] AI analysis failed, continuing without it:', error);
      }
    }

    const startup = await prisma.startup.create({
      data: {
        organizationId,
        ownerId: userId,
        name: proposal.startupName,
        website: proposal.website,
        description: proposal.description,
        stage: aiStage,
        sector: aiSector,
        status: 'reviewing',
        currentScore: proposal.confidence || 50,
        notes: this.buildNotesFromProposal(proposal),
        businessModelAnalysis: businessModelAnalysis ? JSON.parse(JSON.stringify(businessModelAnalysis)) : null,
        draftReply,
        draftReplyStatus: draftReply ? 'pending' : 'none',
        analysisUpdatedAt: businessModelAnalysis ? new Date() : null,
      },
    });

    // Initialize evaluation and scoring for the new startup
    // This ensures the startup has proper scores and can be evaluated
    try {
      // Create evaluation record
      await prisma.startupEvaluation.create({
        data: {
          startupId: startup.id,
          organizationId,
          stage: 'presentation_review',
          isPostRevenue: false, // Default to pre-revenue, can be updated later
        },
      });

      // Set initial base score from AI confidence
      const confidenceScore = Math.round(proposal.confidence || 50);
      const breakdown = {
        team: { base: Math.round(confidenceScore * 0.25), adjusted: 0, subcriteria: {} },
        market: { base: Math.round(confidenceScore * 0.25), adjusted: 0, subcriteria: {} },
        product: { base: Math.round(confidenceScore * 0.20), adjusted: 0, subcriteria: {} },
        traction: { base: Math.round(confidenceScore * 0.20), adjusted: 0, subcriteria: {} },
        deal: { base: Math.round(confidenceScore * 0.10), adjusted: 0, subcriteria: {} },
        communication: 0,
        momentum: 0,
        redFlags: 0,
      };

      // Update startup with proper scoring structure
      await prisma.startup.update({
        where: { id: startup.id },
        data: {
          baseScore: confidenceScore,
          currentScore: confidenceScore,
          scoreBreakdown: breakdown as unknown as object,
          scoreUpdatedAt: new Date(),
        },
      });

      // Create initial score event with positive impact
      await prisma.scoreEvent.create({
        data: {
          startupId: startup.id,
          category: 'communication',
          signal: 'Email proposal received - initial evaluation',
          impact: 0, // Neutral impact, baseScore is already set
          confidence: proposal.confidence / 100,
          source: `email_intake_${proposal.rawSource}`,
          evidence: `Extracted from ${proposal.rawSource} with ${proposal.confidence}% confidence`,
          analyzedBy: 'ai',
        },
      });

      console.log(`[StartupCreation] Initialized evaluation and scoring for ${proposal.startupName} (score: ${confidenceScore})`);
    } catch (error) {
      console.error('[StartupCreation] Failed to initialize evaluation, continuing...', error);
      // Don't fail the entire startup creation if evaluation initialization fails
    }

    // Add founder as contact if email provided
    if (proposal.founderEmail || proposal.contactInfo?.email) {
      await prisma.startupContact.create({
        data: {
          startupId: startup.id,
          email: proposal.founderEmail || proposal.contactInfo?.email || '',
          name: proposal.founderName,
          role: 'Founder',
          matchType: 'manual',
        },
      });
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        organizationId,
        userId,
        startupId: startup.id,
        action: 'startup_created_from_email',
        details: JSON.stringify({
          source: proposal.rawSource,
          confidence: proposal.confidence,
          sector: aiSector,
          hasAnalysis: !!businessModelAnalysis,
          hasDraftReply: !!draftReply,
        }),
      },
    });

    return startup.id;
  }

  /**
   * Build notes from proposal
   */
  private buildNotesFromProposal(proposal: ExtractedStartupProposal): string {
    const lines: string[] = [];

    if (proposal.sector) {
      lines.push(`Sector: ${proposal.sector}`);
    }
    if (proposal.askAmount) {
      lines.push(`Raising: ${proposal.askAmount}`);
    }
    if (proposal.location) {
      lines.push(`Location: ${proposal.location}`);
    }
    if (proposal.founderName) {
      lines.push(`Founder: ${proposal.founderName}`);
    }
    if (proposal.founderLinkedIn || proposal.contactInfo?.linkedin) {
      lines.push(`LinkedIn: ${proposal.founderLinkedIn || proposal.contactInfo?.linkedin}`);
    }
    if (proposal.keyHighlights?.length) {
      lines.push('');
      lines.push('Key Highlights:');
      proposal.keyHighlights.forEach((h) => lines.push(`• ${h}`));
    }
    lines.push('');
    lines.push(`[Imported from ${proposal.rawSource} with ${proposal.confidence}% confidence]`);

    return lines.join('\n');
  }

  /**
   * Process all unread emails and create startups
   */
  async processInbox(
    config: InboxConfig,
    organizationId: string,
    userId: string
  ): Promise<ProcessedEmail[]> {
    const results: ProcessedEmail[] = [];

    const emails = await this.fetchUnreadEmails(config);

    for (const mail of emails) {
      const emailContent = this.mailToEmailContent(mail);
      const result: ProcessedEmail = {
        messageId: mail.messageId || `${Date.now()}`,
        subject: emailContent.subject,
        from: emailContent.from,
        date: mail.date || new Date(),
      };

      try {
        const proposal = await this.extractProposalFromEmail(emailContent);

        if (proposal && proposal.startupName && proposal.confidence >= 50) {
          result.proposal = proposal;
          result.startupId = await this.createStartupFromProposal(
            proposal,
            organizationId,
            userId
          );
        }
      } catch (error) {
        result.error = error instanceof Error ? error.message : 'Unknown error';
      }

      results.push(result);
    }

    return results;
  }

  /**
   * Full sync: fetch emails, extract proposals, and add to review queue
   * (no longer creates startups directly - user must approve from queue)
   */
  async syncInbox(
    config: InboxConfig,
    organizationId: string,
    userId: string
  ): Promise<SyncResult> {
    const results: ProcessedEmail[] = [];
    let queued = 0;

    console.log('[EmailSync] Starting inbox sync...');

    // Fetch recent emails (last 7 days) instead of just unread
    const emails = await this.fetchRecentEmails(config, 50, 7);
    console.log(`[EmailSync] Processing ${emails.length} emails...`);

    for (const mail of emails) {
      const emailContent = this.mailToEmailContent(mail);
      const messageId = mail.messageId || `${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Check if this email has already been queued or processed
      const existingInQueue = await prisma.proposalQueue.findUnique({
        where: { emailMessageId: messageId },
      });

      if (existingInQueue) {
        console.log(`[EmailSync] Skipping already queued email: ${mail.subject}`);
        continue;
      }

      const result: ProcessedEmail = {
        messageId,
        subject: emailContent.subject,
        from: emailContent.from,
        date: mail.date || new Date(),
        deckIds: [],
      };

      console.log(`[EmailSync] Processing email: "${mail.subject}" from ${emailContent.from}`);

      try {
        // Step 1: Extract startup proposal from email content with stricter filtering
        let proposal: ExtractedStartupProposal | null = null;
        try {
          proposal = await this.extractProposalFromEmail(emailContent);
          console.log(`[EmailSync] AI extraction result:`, proposal ? `Found: ${proposal.startupName} (${proposal.confidence}% confidence)` : 'No proposal found');
        } catch (aiError) {
          const errorMessage = aiError instanceof Error ? aiError.message : String(aiError);
          if (errorMessage.includes('429') || errorMessage.includes('quota')) {
            console.error('[EmailSync] AI quota exceeded. Please check your API billing.');
            result.error = 'AI quota exceeded - please check your API billing or wait for quota reset';
            results.push(result);
            continue;
          }
          throw aiError;
        }

        // Only queue if we found a valid proposal with reasonable confidence
        // Increased threshold to 60 to filter out newsletters
        if (proposal && proposal.startupName && proposal.confidence >= 60) {
          result.proposal = proposal;

          // Check if startup with same name already exists in queue or as startup
          // Note: SQLite doesn't support case-insensitive mode, so we use LOWER()
          const existingByName = await prisma.proposalQueue.findFirst({
            where: {
              organizationId,
              startupName: proposal.startupName,
            },
          });

          const existingStartup = await prisma.startup.findFirst({
            where: {
              organizationId,
              name: proposal.startupName,
            },
          });

          if (existingByName || existingStartup) {
            console.log(`[EmailSync] Skipping duplicate startup name: ${proposal.startupName}`);
            continue;
          }

          // Add to queue instead of creating startup directly
          const fromAddress = mail.from?.value?.[0];

          // Extract PDF attachments for later processing
          const attachments: Array<{
            filename: string;
            contentType: string;
            size: number;
            contentBase64: string;
          }> = [];

          if (mail.attachments && mail.attachments.length > 0) {
            for (const attachment of mail.attachments) {
              if (attachment.contentType === 'application/pdf' && attachment.content) {
                attachments.push({
                  filename: attachment.filename || 'attachment.pdf',
                  contentType: attachment.contentType,
                  size: attachment.size || attachment.content.length,
                  contentBase64: attachment.content.toString('base64'),
                });
                console.log(`[EmailSync] Stored PDF attachment: ${attachment.filename}`);
              }
            }
          }

          await prisma.proposalQueue.create({
            data: {
              organizationId,
              userId,
              emailMessageId: messageId,
              emailSubject: emailContent.subject,
              emailFrom: fromAddress?.address || 'unknown@unknown.com',
              emailFromName: fromAddress?.name || null,
              emailDate: mail.date || new Date(),
              emailPreview: (emailContent.body || '').substring(0, 1000),
              startupName: proposal.startupName,
              description: proposal.description || null,
              website: proposal.website || null,
              founderName: proposal.founderName || null,
              founderEmail: proposal.founderEmail || proposal.contactInfo?.email || null,
              askAmount: proposal.askAmount || null,
              stage: proposal.stage || null,
              extractedData: proposal as unknown as object,
              confidence: proposal.confidence / 100, // Store as 0-1
              aiReason: proposal.rawSource || null,
              status: 'pending',
              attachments: attachments.length > 0 ? attachments : undefined,
            },
          });

          queued++;
          console.log(`[EmailSync] Added to queue: ${proposal.startupName}`);
        } else if (proposal) {
          console.log(`[EmailSync] Skipped (low confidence ${proposal.confidence}% or newsletter): ${mail.subject}`);
        }
      } catch (error) {
        result.error = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error processing email "${result.subject}":`, error);
      }

      results.push(result);
    }

    const failed = results.filter((r) => r.error).length;

    return {
      processed: results.length,
      created: 0, // No longer creates directly
      skipped: results.length - queued - failed,
      failed,
      decksProcessed: 0,
      emailsLinked: 0,
      queued,
      results,
    };
  }

  /**
   * Get all pending proposals from queue
   */
  async getQueuedProposals(organizationId: string): Promise<QueuedProposal[]> {
    const proposals = await prisma.proposalQueue.findMany({
      where: {
        organizationId,
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
    });

    return proposals.map((p) => ({
      id: p.id,
      emailSubject: p.emailSubject,
      emailFrom: p.emailFrom,
      emailFromName: p.emailFromName ?? undefined,
      emailDate: p.emailDate,
      emailPreview: p.emailPreview,
      startupName: p.startupName,
      description: p.description ?? undefined,
      website: p.website ?? undefined,
      founderName: p.founderName ?? undefined,
      founderEmail: p.founderEmail ?? undefined,
      askAmount: p.askAmount ?? undefined,
      stage: p.stage ?? undefined,
      confidence: p.confidence,
      aiReason: p.aiReason ?? undefined,
      status: p.status,
      createdAt: p.createdAt,
    }));
  }

  /**
   * Approve a proposal from the queue and create startup
   */
  async approveProposal(proposalId: string, userId: string): Promise<string> {
    const proposal = await prisma.proposalQueue.findUnique({
      where: { id: proposalId },
    });

    if (!proposal) {
      throw new Error('Proposal not found');
    }

    if (proposal.status !== 'pending') {
      throw new Error('Proposal already processed');
    }

    // Create the startup from the queued data
    const extractedData = proposal.extractedData as ExtractedStartupProposal | null;

    const startupId = await this.createStartupFromProposal(
      {
        startupName: proposal.startupName,
        description: proposal.description || undefined,
        website: proposal.website || undefined,
        founderName: proposal.founderName || undefined,
        founderEmail: proposal.founderEmail || undefined,
        askAmount: proposal.askAmount || undefined,
        stage: proposal.stage || undefined,
        confidence: proposal.confidence * 100,
        rawSource: 'email',
        ...extractedData,
      } as ExtractedStartupProposal,
      proposal.organizationId,
      userId
    );

    // Create an Email record for the original proposal email
    await prisma.email.create({
      data: {
        organizationId: proposal.organizationId,
        userId,
        startupId,
        outlookId: proposal.emailMessageId,
        subject: proposal.emailSubject,
        fromAddress: proposal.emailFrom,
        fromName: proposal.emailFromName,
        toAddresses: [], // Original recipient info not stored in proposal
        bodyPreview: proposal.emailPreview.substring(0, 500),
        bodyHtml: proposal.emailPreview.replace(/\n/g, '<br>'),
        receivedAt: proposal.emailDate,
        direction: 'inbound',
        matchConfidence: 1.0,
        isRead: true,
      },
    });

    // Process any PDF attachments from the email
    const attachments = proposal.attachments as Array<{
      filename: string;
      contentType: string;
      size: number;
      contentBase64: string;
    }> | null;

    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        try {
          // Convert base64 back to buffer
          const content = Buffer.from(attachment.contentBase64, 'base64');

          // Extract text from PDF
          let extractedText = '';
          try {
            const pdfData = await pdfParse(content);
            extractedText = pdfData.text;
            console.log(`[ProposalApprove] Extracted ${extractedText.length} chars from ${attachment.filename}`);
          } catch (pdfError) {
            console.error(`[ProposalApprove] Failed to parse PDF ${attachment.filename}:`, pdfError);
          }

          // Create pitch deck record
          const deck = await prisma.pitchDeck.create({
            data: {
              startupId,
              fileUrl: `email-attachment://${proposal.emailMessageId}/${attachment.filename}`,
              fileName: attachment.filename,
              fileSize: attachment.size,
              mimeType: attachment.contentType,
              extractedText: extractedText || null,
              uploadedBy: userId,
            },
          });

          console.log(`[ProposalApprove] Created pitch deck record: ${deck.id} for ${attachment.filename}`);

          // Process with AI asynchronously if we have text
          if (extractedText && aiService.enabled) {
            this.processDeckWithAI(deck.id, startupId, extractedText, userId).catch((error) => {
              console.error(`[ProposalApprove] Error processing deck ${deck.id} with AI:`, error);
            });
          }
        } catch (attachmentError) {
          console.error(`[ProposalApprove] Error processing attachment ${attachment.filename}:`, attachmentError);
        }
      }
    }

    // Update the queue entry
    await prisma.proposalQueue.update({
      where: { id: proposalId },
      data: {
        status: 'approved',
        reviewedAt: new Date(),
        reviewedBy: userId,
        createdStartupId: startupId,
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        organizationId: proposal.organizationId,
        userId,
        startupId,
        action: 'proposal_approved',
        details: JSON.stringify({
          proposalId,
          emailSubject: proposal.emailSubject,
        }),
      },
    });

    return startupId;
  }

  /**
   * Reject a proposal from the queue and send rejection email
   */
  async rejectProposal(proposalId: string, userId: string, reason?: string): Promise<{ emailSent: boolean }> {
    const proposal = await prisma.proposalQueue.findUnique({
      where: { id: proposalId },
    });

    if (!proposal) {
      throw new Error('Proposal not found');
    }

    if (proposal.status !== 'pending' && proposal.status !== 'snoozed') {
      throw new Error('Proposal already processed');
    }

    // Update proposal status
    await prisma.proposalQueue.update({
      where: { id: proposalId },
      data: {
        status: 'rejected',
        reviewedAt: new Date(),
        reviewedBy: userId,
        rejectionReason: reason || null,
      },
    });

    // Add to rejected emails list to prevent re-pickup
    if (proposal.founderEmail) {
      await prisma.rejectedEmail.upsert({
        where: {
          organizationId_emailAddress: {
            organizationId: proposal.organizationId,
            emailAddress: proposal.founderEmail,
          },
        },
        update: {
          startupName: proposal.startupName,
          reason: reason || 'Not a fit at this time',
          rejectedAt: new Date(),
          rejectedBy: userId,
        },
        create: {
          organizationId: proposal.organizationId,
          emailAddress: proposal.founderEmail,
          startupName: proposal.startupName,
          reason: reason || 'Not a fit at this time',
          rejectedBy: userId,
        },
      });
    }

    // Send rejection email if we have a founder email
    let emailSent = false;
    if (proposal.founderEmail && aiService.enabled) {
      try {
        const rejectionEmail = await aiService.generateRejectionEmail({
          name: proposal.startupName,
          founderName: proposal.founderName,
          description: proposal.description,
        });

        await emailService.sendEmail({
          to: proposal.founderEmail,
          subject: `Re: ${proposal.startupName}`,
          body: rejectionEmail,
          organizationId: proposal.organizationId,
          userId,
        });

        emailSent = true;
        console.log(`[RejectProposal] Sent rejection email to ${proposal.founderEmail}`);
      } catch (error) {
        console.error('[RejectProposal] Failed to send rejection email:', error);
      }
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        organizationId: proposal.organizationId,
        userId,
        action: 'proposal_rejected',
        details: JSON.stringify({
          proposalId,
          emailSubject: proposal.emailSubject,
          reason,
          emailSent,
        }),
      },
    });

    return { emailSent };
  }

  /**
   * Snooze a proposal - send follow-up email and await progress updates
   */
  async snoozeProposal(proposalId: string, userId: string): Promise<{ emailSent: boolean }> {
    const proposal = await prisma.proposalQueue.findUnique({
      where: { id: proposalId },
    });

    if (!proposal) {
      throw new Error('Proposal not found');
    }

    if (proposal.status !== 'pending' && proposal.status !== 'snoozed') {
      throw new Error('Proposal already processed');
    }

    // Set snooze until 30 days from now (when we'll check for progress)
    const snoozedUntil = new Date();
    snoozedUntil.setDate(snoozedUntil.getDate() + 30);

    // Update proposal status
    await prisma.proposalQueue.update({
      where: { id: proposalId },
      data: {
        status: 'snoozed',
        reviewedAt: new Date(),
        reviewedBy: userId,
        snoozedUntil,
        snoozeCount: { increment: 1 },
      },
    });

    // Send snooze/follow-up email if we have a founder email
    let emailSent = false;
    if (proposal.founderEmail && aiService.enabled) {
      try {
        const snoozeEmail = await aiService.generateSnoozeEmail({
          name: proposal.startupName,
          founderName: proposal.founderName,
          description: proposal.description,
        });

        await emailService.sendEmail({
          to: proposal.founderEmail,
          subject: `Re: ${proposal.startupName} - Looking forward to updates`,
          body: snoozeEmail,
          organizationId: proposal.organizationId,
          userId,
        });

        emailSent = true;
        console.log(`[SnoozeProposal] Sent snooze email to ${proposal.founderEmail}`);
      } catch (error) {
        console.error('[SnoozeProposal] Failed to send snooze email:', error);
      }
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        organizationId: proposal.organizationId,
        userId,
        action: 'proposal_snoozed',
        details: JSON.stringify({
          proposalId,
          emailSubject: proposal.emailSubject,
          snoozedUntil: snoozedUntil.toISOString(),
          snoozeCount: (proposal.snoozeCount || 0) + 1,
          emailSent,
        }),
      },
    });

    return { emailSent };
  }

  /**
   * Check if an email is from a rejected founder
   */
  async isRejectedEmail(organizationId: string, emailAddress: string): Promise<boolean> {
    const rejected = await prisma.rejectedEmail.findUnique({
      where: {
        organizationId_emailAddress: {
          organizationId,
          emailAddress,
        },
      },
    });
    return !!rejected;
  }

  /**
   * Check snoozed proposals for progress updates
   * This should be called periodically (e.g., daily)
   */
  async checkSnoozedProposals(organizationId: string): Promise<{
    checked: number;
    reactivated: number;
    rejected: number;
    keepSnoozed: number;
  }> {
    // Find snoozed proposals with emails from the same founder
    const snoozedProposals = await prisma.proposalQueue.findMany({
      where: {
        organizationId,
        status: 'snoozed',
        founderEmail: { not: null },
      },
    });

    let checked = 0;
    let reactivated = 0;
    let rejected = 0;
    let keepSnoozed = 0;

    for (const proposal of snoozedProposals) {
      // Look for new emails from this founder since the snooze
      const newEmails = await prisma.proposalQueue.findMany({
        where: {
          organizationId,
          emailFrom: proposal.emailFrom,
          status: 'pending',
          createdAt: { gt: proposal.reviewedAt || proposal.createdAt },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      if (newEmails.length === 0) {
        continue;
      }

      checked++;
      const updateEmail = newEmails[0]!;

      // Evaluate progress using AI
      if (aiService.enabled) {
        try {
          const evaluation = await aiService.evaluateProgress(
            {
              name: proposal.startupName,
              description: proposal.description,
              stage: proposal.stage,
              extractedData: proposal.extractedData as Record<string, unknown> | null,
            },
            {
              subject: updateEmail.emailSubject,
              body: updateEmail.emailPreview,
              from: updateEmail.emailFrom,
            }
          );

          // Update the original proposal with progress notes
          await prisma.proposalQueue.update({
            where: { id: proposal.id },
            data: {
              lastProgressCheck: new Date(),
              progressNotes: evaluation.progressSummary,
            },
          });

          if (evaluation.recommendation === 'reactivate') {
            // Move back to pending for review
            await prisma.proposalQueue.update({
              where: { id: proposal.id },
              data: {
                status: 'pending',
                progressNotes: `REACTIVATED: ${evaluation.progressSummary}\nKey changes: ${evaluation.keyChanges.join(', ')}`,
              },
            });
            reactivated++;
            console.log(`[SnoozedCheck] Reactivated ${proposal.startupName}: ${evaluation.progressSummary}`);
          } else if (evaluation.recommendation === 'reject') {
            // Too many snoozes or spam - reject
            await this.rejectProposal(proposal.id, proposal.reviewedBy || proposal.userId, 'No meaningful progress after multiple follow-ups');
            rejected++;
            console.log(`[SnoozedCheck] Rejected ${proposal.startupName}: ${evaluation.progressSummary}`);
          } else {
            keepSnoozed++;
          }

          // Mark the update email as processed (reject it since we've absorbed its info)
          await prisma.proposalQueue.update({
            where: { id: updateEmail.id },
            data: {
              status: 'rejected',
              rejectionReason: 'Follow-up to snoozed proposal - merged into original',
            },
          });
        } catch (error) {
          console.error(`[SnoozedCheck] Error evaluating progress for ${proposal.startupName}:`, error);
        }
      }
    }

    return { checked, reactivated, rejected, keepSnoozed };
  }

  /**
   * Create an Email record in the database
   */
  private async createEmailRecord(
    mail: ParsedMail,
    organizationId: string,
    userId: string,
    startupId: string
  ): Promise<{ id: string }> {
    const fromAddress = mail.from?.value?.[0];
    const toAddresses = mail.to
      ? (Array.isArray(mail.to) ? mail.to : [mail.to]).flatMap((addr) =>
          addr.value.map((v) => ({ email: v.address, name: v.name }))
        )
      : [];
    const ccAddresses = mail.cc
      ? (Array.isArray(mail.cc) ? mail.cc : [mail.cc]).flatMap((addr) =>
          addr.value.map((v) => ({ email: v.address, name: v.name }))
        )
      : [];

    // Use messageId as outlookId (unique identifier)
    const outlookId = mail.messageId || `sync-${uuidv4()}`;

    // Check if email already exists
    const existingEmail = await prisma.email.findUnique({
      where: { outlookId },
    });

    if (existingEmail) {
      // Update the startup link if not set
      if (!existingEmail.startupId && startupId) {
        await prisma.email.update({
          where: { id: existingEmail.id },
          data: { startupId },
        });
      }
      return { id: existingEmail.id };
    }

    const email = await prisma.email.create({
      data: {
        organizationId,
        userId,
        startupId,
        outlookId,
        conversationId: mail.references?.[0] || mail.messageId || null,
        subject: mail.subject || 'No Subject',
        fromAddress: fromAddress?.address || 'unknown@unknown.com',
        fromName: fromAddress?.name || null,
        toAddresses: toAddresses as unknown as object,
        ccAddresses: ccAddresses.length > 0 ? (ccAddresses as unknown as object) : undefined,
        bodyPreview: (mail.text || '').substring(0, 500),
        bodyHtml: typeof mail.html === 'string' ? mail.html : null,
        receivedAt: mail.date || new Date(),
        direction: 'inbound',
        matchConfidence: 1.0,
        hasAttachments: (mail.attachments?.length || 0) > 0,
        isRead: true,
      },
    });

    // Update communication metrics for the startup
    await this.updateCommunicationMetrics(startupId);

    return { id: email.id };
  }

  /**
   * Process a PDF attachment as a pitch deck
   */
  private async processAttachmentAsDeck(
    attachment: Attachment,
    startupId: string,
    userId: string
  ): Promise<string | null> {
    if (!attachment.content || attachment.contentType !== 'application/pdf') {
      return null;
    }

    // Extract text from PDF
    let extractedText = '';
    try {
      const pdfData = await pdfParse(attachment.content);
      extractedText = pdfData.text;
    } catch (error) {
      console.error('PDF parsing error:', error);
      return null;
    }

    // Create file URL (in production, upload to S3)
    const fileUrl = `file://${uuidv4()}-${attachment.filename || 'attachment.pdf'}`;

    // Create pitch deck record
    const deck = await prisma.pitchDeck.create({
      data: {
        startupId,
        fileUrl,
        fileName: attachment.filename || 'attachment.pdf',
        fileSize: attachment.size || attachment.content.length,
        mimeType: 'application/pdf',
        extractedText,
        uploadedBy: userId,
      },
    });

    // Process with AI asynchronously
    this.processDeckWithAI(deck.id, startupId, extractedText, userId).catch((error) => {
      console.error(`Error processing deck ${deck.id}:`, error);
    });

    return deck.id;
  }

  /**
   * Process deck with AI (adapted from decks.routes.ts)
   */
  private async processDeckWithAI(
    deckId: string,
    startupId: string,
    extractedText: string,
    userId: string
  ): Promise<void> {
    try {
      if (!aiService.enabled) {
        console.log('AI service not enabled, skipping deck analysis');
        return;
      }

      // Process deck with AI
      const { extractedData, analysis } = await aiService.processDeck(extractedText);

      // Update deck with results
      await prisma.pitchDeck.update({
        where: { id: deckId },
        data: {
          extractedData: extractedData as unknown as object,
          aiAnalysis: analysis as unknown as object,
        },
      });

      // Update startup with extracted data if not already set
      const startup = await prisma.startup.findUnique({
        where: { id: startupId },
        select: { founders: true, metrics: true, description: true, organizationId: true },
      });

      if (startup) {
        const updateData: Record<string, unknown> = {};
        if (!startup.founders && extractedData.team) {
          updateData.founders = extractedData.team as unknown as object;
        }
        if (!startup.metrics && extractedData.traction) {
          updateData.metrics = extractedData.traction as unknown as object;
        }
        if (!startup.description && (extractedData.tagline || extractedData.solution)) {
          updateData.description = extractedData.tagline ?? extractedData.solution;
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.startup.update({
            where: { id: startupId },
            data: updateData,
          });
        }

        // Set base score if not already set
        const existingScore = await prisma.startup.findUnique({
          where: { id: startupId },
          select: { baseScore: true },
        });

        if (!existingScore?.baseScore) {
          await scoringService.setBaseScore(startupId, analysis.breakdown);
        }

        // Create score events from deck analysis
        const events: Array<{
          startupId: string;
          source: 'deck';
          sourceId: string;
          category: ScoreCategory;
          signal: string;
          impact: number;
          confidence: number;
          evidence: string;
          analyzedBy: 'ai';
        }> = [];

        for (const strength of analysis.strengths) {
          events.push({
            startupId,
            source: 'deck' as const,
            sourceId: deckId,
            category: 'momentum' as const,
            signal: `Strength: ${strength}`,
            impact: 1,
            confidence: 0.8,
            evidence: strength,
            analyzedBy: 'ai' as const,
          });
        }

        for (const weakness of analysis.weaknesses) {
          events.push({
            startupId,
            source: 'deck' as const,
            sourceId: deckId,
            category: 'red_flag' as const,
            signal: `Weakness: ${weakness}`,
            impact: -0.5,
            confidence: 0.8,
            evidence: weakness,
            analyzedBy: 'ai' as const,
          });
        }

        if (events.length > 0) {
          await scoringService.addScoreEvents(events);
        }

        // Log activity
        await prisma.activityLog.create({
          data: {
            organizationId: startup.organizationId,
            userId,
            startupId,
            action: 'deck_analyzed_from_sync',
            details: {
              deckId,
              score: analysis.score,
            },
          },
        });
      }

      console.log(`Deck ${deckId} processed successfully. Score: ${analysis.score}`);
    } catch (error) {
      console.error(`Error processing deck ${deckId}:`, error);

      await prisma.pitchDeck.update({
        where: { id: deckId },
        data: {
          aiAnalysis: {
            error: true,
            message: error instanceof Error ? error.message : 'Processing failed',
          },
        },
      });
    }
  }

  /**
   * Update communication metrics for a startup
   */
  private async updateCommunicationMetrics(startupId: string): Promise<void> {
    try {
      const emailCount = await prisma.email.count({
        where: { startupId },
      });

      await prisma.communicationMetrics.upsert({
        where: { startupId },
        create: {
          startupId,
          totalEmails: emailCount,
        },
        update: {
          totalEmails: emailCount,
          lastCalculated: new Date(),
        },
      });
    } catch (error) {
      console.error('Error updating communication metrics:', error);
    }
  }

  /**
   * Start polling the inbox at regular intervals
   */
  startPolling(
    config: InboxConfig,
    organizationId: string,
    userId: string,
    intervalMinutes = 5
  ): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    this.config = config;

    // Initial fetch
    this.processInbox(config, organizationId, userId).catch(console.error);

    // Set up polling
    this.pollingInterval = setInterval(
      () => {
        this.processInbox(config, organizationId, userId).catch(console.error);
      },
      intervalMinutes * 60 * 1000
    );
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}

export const emailInboxService = new EmailInboxService();
