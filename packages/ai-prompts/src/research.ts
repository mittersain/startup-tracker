export const COMPANY_RESEARCH_PROMPT = `
You are a venture capital research analyst. Compile a research report on this startup using the provided information.

STARTUP INFORMATION:
Name: {company_name}
Website: {website}
Description: {description}
Founders: {founders}

SEARCH RESULTS:
{search_results}

Compile a research report covering:

1. COMPANY OVERVIEW
   - What does the company do?
   - When was it founded?
   - Where is it headquartered?
   - What stage is the company at?

2. FOUNDING TEAM
   - Who are the founders?
   - What is their background?
   - Previous companies or exits?
   - LinkedIn presence and credibility

3. MARKET & COMPETITION
   - Who are the main competitors?
   - What is the company's differentiation?
   - Market trends and dynamics
   - Potential market size

4. TRACTION & NEWS
   - Recent news or press coverage
   - Any announced funding rounds
   - Notable customers or partnerships
   - Product launches or milestones

5. RED FLAGS & CONCERNS
   - Any negative press or controversies
   - Glassdoor or employee concerns
   - Legal or regulatory issues
   - Competitive threats

OUTPUT FORMAT (JSON):
{
  "companyOverview": {
    "description": "string",
    "founded": "string - Year or date",
    "headquarters": "string",
    "stage": "string",
    "employeeCount": "number or null"
  },
  "team": {
    "founders": [
      {
        "name": "string",
        "role": "string",
        "background": "string",
        "linkedinUrl": "string or null",
        "previousCompanies": ["string"],
        "credibilityScore": "number 0-10"
      }
    ],
    "teamSize": "number or null",
    "keyHires": ["string"]
  },
  "market": {
    "competitors": [
      {
        "name": "string",
        "description": "string",
        "fundingRaised": "string or null"
      }
    ],
    "differentiation": "string",
    "marketTrends": ["string"],
    "estimatedMarketSize": "string or null"
  },
  "traction": {
    "recentNews": [
      {
        "headline": "string",
        "date": "string",
        "source": "string",
        "summary": "string"
      }
    ],
    "fundingHistory": [
      {
        "round": "string",
        "amount": "string",
        "date": "string",
        "investors": ["string"]
      }
    ],
    "partnerships": ["string"],
    "productMilestones": ["string"]
  },
  "concerns": {
    "redFlags": [
      {
        "type": "string",
        "description": "string",
        "severity": "low | medium | high",
        "source": "string"
      }
    ],
    "competitiveThreats": ["string"],
    "marketRisks": ["string"]
  },
  "summary": "string - 2-3 paragraph investment research summary",
  "confidenceLevel": "low | medium | high - How confident are you in this research",
  "suggestedFollowUp": ["string - Additional research or questions to pursue"]
}

Be factual and cite sources where possible. Clearly distinguish between confirmed facts and speculation.
If information is not available, say so rather than guessing.
`;

export interface ResearchContext {
  companyName: string;
  website?: string;
  description?: string;
  founders?: Array<{ name: string; role: string }>;
  searchResults: string;
}

export function buildCompanyResearchPrompt(context: ResearchContext): string {
  let prompt = COMPANY_RESEARCH_PROMPT;

  prompt = prompt.replace('{company_name}', context.companyName);
  prompt = prompt.replace('{website}', context.website ?? 'Not provided');
  prompt = prompt.replace('{description}', context.description ?? 'Not provided');
  prompt = prompt.replace(
    '{founders}',
    context.founders
      ? context.founders.map((f) => `${f.name} (${f.role})`).join(', ')
      : 'Not provided'
  );
  prompt = prompt.replace('{search_results}', context.searchResults);

  return prompt;
}

export const FOUNDER_BACKGROUND_PROMPT = `
Research the background of this startup founder.

FOUNDER: {founder_name}
ROLE: {founder_role}
COMPANY: {company_name}
LINKEDIN: {linkedin_url}

SEARCH RESULTS:
{search_results}

Compile a founder background report:

OUTPUT FORMAT (JSON):
{
  "name": "string",
  "currentRole": "string",
  "summary": "string - 2-3 sentence bio",
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field": "string",
      "year": "string or null"
    }
  ],
  "workHistory": [
    {
      "company": "string",
      "role": "string",
      "duration": "string",
      "description": "string"
    }
  ],
  "startupExperience": [
    {
      "company": "string",
      "role": "string",
      "outcome": "string - acquired, failed, ongoing, etc.",
      "raised": "string or null"
    }
  ],
  "domainExpertise": ["string - Areas of expertise"],
  "notableAchievements": ["string"],
  "publications": ["string - Articles, patents, etc."],
  "socialPresence": {
    "linkedinFollowers": "number or null",
    "twitterFollowers": "number or null",
    "thoughtLeadership": "low | medium | high"
  },
  "credibilityAssessment": {
    "score": "number 0-10",
    "strengths": ["string"],
    "concerns": ["string"],
    "summary": "string"
  }
}

Focus on facts that are verifiable. Note the confidence level of information.
Pay special attention to previous startup experience and outcomes.
`;

export function buildFounderBackgroundPrompt(
  founderName: string,
  founderRole: string,
  companyName: string,
  linkedinUrl: string | null,
  searchResults: string
): string {
  return FOUNDER_BACKGROUND_PROMPT
    .replace('{founder_name}', founderName)
    .replace('{founder_role}', founderRole)
    .replace('{company_name}', companyName)
    .replace('{linkedin_url}', linkedinUrl ?? 'Not provided')
    .replace('{search_results}', searchResults);
}
