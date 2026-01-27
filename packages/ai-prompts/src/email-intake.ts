/**
 * AI prompts for parsing forwarded startup proposal emails
 */

export interface ForwardedEmailContent {
  subject: string;
  body: string;
  from: string;
  date?: string;
  attachmentNames?: string[];
}

export interface ExtractedStartupProposal {
  startupName: string;
  founderName?: string;
  founderEmail?: string;
  founderLinkedIn?: string;
  website?: string;
  description: string;
  stage?: string;
  sector?: string;
  askAmount?: string;
  location?: string;
  keyHighlights?: string[];
  contactInfo?: {
    email?: string;
    phone?: string;
    linkedin?: string;
  };
  confidence: number; // 0-100 confidence score for extraction quality
  rawSource: 'linkedin' | 'email' | 'other';
}

export function buildEmailIntakePrompt(email: ForwardedEmailContent): string {
  return `You are an expert at identifying GENUINE startup investment proposals from emails.

Your job is to determine if this email contains a REAL startup pitch/proposal seeking investment.

IMPORTANT - First determine if this is a REAL startup proposal. It is NOT a proposal if it is:
- A newsletter or digest (e.g., "This week's top stories", "Weekly roundup", "Newsletter")
- Marketing/promotional email (e.g., from established companies, product updates)
- Job postings or recruitment emails
- Event invitations or announcements
- General news or industry updates
- Personal correspondence not seeking investment
- Spam or automated messages
- Company updates not seeking funding
- Emails with multiple unrelated startups (likely a newsletter)

It IS a genuine startup proposal if:
- A founder is directly pitching their startup for investment
- Someone is introducing a specific startup founder seeking funding
- A forwarded message from a founder via LinkedIn asking for a meeting
- An email with a pitch deck attached from a founder
- A warm introduction to a startup seeking investment

EMAIL DETAILS:
From: ${email.from}
Subject: ${email.subject}
Date: ${email.date || 'Unknown'}
${email.attachmentNames?.length ? `Attachments: ${email.attachmentNames.join(', ')}` : ''}

EMAIL BODY:
${email.body}

---

If this is NOT a genuine startup proposal seeking investment, return:
{"confidence": 0, "rawSource": "other", "reason": "Brief explanation why this is not a proposal"}

If this IS a genuine startup proposal, extract the following and return as JSON:

{
  "startupName": "Name of the startup/company (required)",
  "founderName": "Name of the founder/CEO if mentioned",
  "founderEmail": "Founder's email if present",
  "founderLinkedIn": "LinkedIn profile URL if present",
  "website": "Company website URL if present",
  "description": "Brief description of what the startup does (1-2 sentences)",
  "stage": "Investment stage if mentioned (pre-seed, seed, series-a, series-b, growth)",
  "sector": "Industry/sector (fintech, healthtech, saas, gaming, ecommerce, edtech, etc.)",
  "askAmount": "Funding amount being raised if mentioned",
  "location": "Company/founder location if mentioned",
  "keyHighlights": ["Array of 2-4 key highlights or interesting facts about the startup"],
  "contactInfo": {
    "email": "Best email to contact",
    "phone": "Phone number if available",
    "linkedin": "LinkedIn URL for primary contact"
  },
  "confidence": 70,
  "rawSource": "linkedin or email or other"
}

CONFIDENCE SCORING GUIDELINES:
- 90-100: Clear pitch from founder with company name, description, and funding ask
- 70-89: Likely a pitch but missing some details (e.g., no explicit funding ask)
- 50-69: Possibly a pitch but unclear or incomplete
- Below 50: Probably not a startup proposal (return with confidence 0 if clearly not)

Be STRICT - if you're not confident this is a genuine startup proposal seeking investment, set confidence to 0.

Return ONLY valid JSON, no additional text.`;
}

export function buildBatchEmailIntakePrompt(emails: ForwardedEmailContent[]): string {
  const emailsText = emails.map((email, index) => `
--- EMAIL ${index + 1} ---
From: ${email.from}
Subject: ${email.subject}
Date: ${email.date || 'Unknown'}
Body: ${email.body.substring(0, 2000)}${email.body.length > 2000 ? '...[truncated]' : ''}
`).join('\n');

  return `You are an expert at extracting startup investment proposal information from emails.

Analyze the following ${emails.length} forwarded emails and extract startup/founder information from each.

${emailsText}

---

For each email that contains a startup proposal or pitch, extract the information.
Skip emails that are clearly not startup pitches (newsletters, spam, personal messages, etc.).

Return a JSON array with extracted proposals:

[
  {
    "emailIndex": 0,
    "startupName": "Name of the startup",
    "founderName": "Founder name",
    "founderEmail": "email@example.com",
    "website": "https://startup.com",
    "description": "What the startup does",
    "stage": "seed",
    "sector": "fintech",
    "keyHighlights": ["highlight 1", "highlight 2"],
    "confidence": 85,
    "rawSource": "linkedin"
  }
]

Return ONLY valid JSON array, no additional text. If no valid startup proposals found, return empty array [].`;
}
