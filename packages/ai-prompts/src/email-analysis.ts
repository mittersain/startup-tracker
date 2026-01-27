export const EMAIL_ANALYSIS_PROMPT = `
You are an expert venture capital analyst. Analyze this email thread between an investor and a startup founder to extract signals that indicate how investible this startup is.

CONTEXT:
- Startup: {startup_name}
- Current Score: {current_score}/100
- Previous metrics on file: {known_metrics}
- Time since last email in thread: {time_since_last_email}

EMAIL:
From: {from}
To: {to}
Date: {date}
Subject: {subject}
Body:
{body}

ANALYZE FOR:

1. TRACTION SIGNALS
   - Revenue/growth metrics mentioned
   - Customer wins or losses
   - Product milestones
   - Partnership announcements

2. COMMUNICATION QUALITY
   - Response time assessment (if this is a reply)
   - Was this proactive or reactive?
   - How directly were questions answered?
   - Level of detail provided

3. CONSISTENCY CHECK
   - Compare any metrics to previous values provided
   - Flag inconsistencies or unexplained changes
   - Note if they acknowledged/explained changes

4. RED FLAGS
   - Evasive or vague responses
   - Excuses or blame-shifting
   - Concerning news (team departures, pivots, runway issues)
   - Unrealistic claims or promises

5. MOMENTUM INDICATORS
   - Urgency signals (other investors interested, closing round soon)
   - Timeline updates
   - Hiring activity

OUTPUT FORMAT (JSON):
{
  "signals": [
    {
      "type": "string - Signal type (see list below)",
      "description": "string - What was detected",
      "impact": "number - Score impact from -10 to +10",
      "confidence": "number - Confidence from 0 to 1",
      "quote": "string - Supporting quote from email"
    }
  ],
  "metricsExtracted": [
    {
      "metric": "string - Metric name (arr, mrr, users, growth_rate, etc.)",
      "value": "number - The value",
      "unit": "string - Unit if applicable (USD, users, percent)",
      "previousValue": "number or null - Previous value if we have it",
      "date": "string - ISO date when this was reported"
    }
  ],
  "communicationAssessment": {
    "responsiveness": "fast | normal | slow | not_applicable",
    "transparency": "high | medium | low",
    "directness": "high | medium | low",
    "professionalism": "high | medium | low"
  },
  "sentiment": "positive | neutral | negative",
  "topics": ["string - Main topics discussed"],
  "actionItems": ["string - Any action items or follow-ups mentioned"],
  "redFlags": [
    {
      "type": "string - Red flag type",
      "description": "string - Description",
      "severity": "minor | moderate | major",
      "quote": "string - Supporting quote"
    }
  ],
  "summary": "string - 1-2 sentence summary of the email's significance"
}

SIGNAL TYPES (positive):
- traction_growth: Evidence of growth in key metrics
- revenue_update: New revenue figures shared
- customer_win: New customer acquisition mentioned
- partnership_announced: New partnership or collaboration
- team_hire: Key hire announced
- product_milestone: Product launch, feature release, etc.
- fundraising_momentum: Interest from other investors
- quick_response: Fast reply (under 4 hours)
- proactive_update: Founder reached out unprompted with updates
- transparent_communication: Openly sharing challenges or concerns
- detailed_metrics: Providing granular, specific data

SIGNAL TYPES (negative):
- metric_inconsistency: Numbers don't match previous claims
- missed_deadline: Failed to deliver on promised timeline
- evasive_answer: Avoiding direct response to question
- slow_response: Took more than 48 hours to reply
- team_departure: Key team member leaving
- pivot_announced: Significant strategy change
- runway_concern: Signs of cash flow issues
- legal_issue: Legal or regulatory problems
- customer_churn: Lost customers or declining metrics

Be objective and evidence-based. Only flag issues with clear evidence from the email.
Consider context - not every metric change is inconsistent; growth naturally changes numbers.
`;

export interface EmailAnalysisContext {
  startupName: string;
  currentScore: number;
  knownMetrics: Record<string, number>;
  timeSinceLastEmail: string;
  from: string;
  to: string;
  date: string;
  subject: string;
  body: string;
}

export function buildEmailAnalysisPrompt(context: EmailAnalysisContext): string {
  let prompt = EMAIL_ANALYSIS_PROMPT;

  prompt = prompt.replace('{startup_name}', context.startupName);
  prompt = prompt.replace('{current_score}', context.currentScore.toString());
  prompt = prompt.replace('{known_metrics}', JSON.stringify(context.knownMetrics, null, 2));
  prompt = prompt.replace('{time_since_last_email}', context.timeSinceLastEmail);
  prompt = prompt.replace('{from}', context.from);
  prompt = prompt.replace('{to}', context.to);
  prompt = prompt.replace('{date}', context.date);
  prompt = prompt.replace('{subject}', context.subject);
  prompt = prompt.replace('{body}', context.body);

  return prompt;
}

export const COMMUNICATION_METRICS_PROMPT = `
Analyze the communication patterns in this email thread history to assess the startup's communication quality.

STARTUP: {startup_name}
EMAIL HISTORY (chronological):
{email_history}

Calculate communication metrics:

1. RESPONSIVENESS
   - Average response time in hours
   - Response rate (% of emails that got replies)
   - Trend (improving or declining)

2. TRANSPARENCY
   - How often do they proactively share updates?
   - Do they share both good and bad news?
   - How specific are the metrics they share?

3. CONSISTENCY
   - Have any metrics changed unexpectedly?
   - Do they follow through on commitments?
   - Are their stories consistent over time?

4. PROFESSIONALISM
   - Email quality and clarity
   - Tone and demeanor
   - Respect for investor's time

OUTPUT FORMAT (JSON):
{
  "responsiveness": {
    "score": "number 0-10",
    "avgResponseTimeHours": "number",
    "responseRate": "number 0-1",
    "trend": "improving | stable | declining",
    "notes": "string"
  },
  "transparency": {
    "score": "number 0-10",
    "proactiveUpdates": "number - Count",
    "metricsShared": ["string - Types of metrics shared"],
    "sharesNegativeNews": "boolean",
    "notes": "string"
  },
  "consistency": {
    "score": "number 0-10",
    "inconsistencies": [
      {
        "metric": "string",
        "issue": "string",
        "severity": "minor | moderate | major"
      }
    ],
    "missedCommitments": "number",
    "notes": "string"
  },
  "professionalism": {
    "score": "number 0-10",
    "avgSentiment": "number -1 to 1",
    "notes": "string"
  },
  "overallCommunicationScore": "number 0-10",
  "summary": "string - Overall assessment of communication quality"
}
`;

export function buildCommunicationMetricsPrompt(
  startupName: string,
  emailHistory: Array<{ from: string; to: string; date: string; subject: string; body: string }>
): string {
  const historyText = emailHistory
    .map((e, i) => `--- Email ${i + 1} ---\nFrom: ${e.from}\nTo: ${e.to}\nDate: ${e.date}\nSubject: ${e.subject}\n\n${e.body}\n`)
    .join('\n\n');

  return COMMUNICATION_METRICS_PROMPT
    .replace('{startup_name}', startupName)
    .replace('{email_history}', historyText);
}
