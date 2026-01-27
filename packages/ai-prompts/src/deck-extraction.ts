export const DECK_EXTRACTION_PROMPT = `
You are an expert venture capital analyst. Extract structured information from this pitch deck.

PITCH DECK CONTENT:
{deck_text}

Extract the following information. If a field is not found, use null.

OUTPUT FORMAT (JSON):
{
  "companyName": "string - Company name",
  "tagline": "string - One-line description or tagline",
  "problem": "string - The problem being solved",
  "solution": "string - The proposed solution",
  "market": {
    "tam": "number - Total Addressable Market in USD",
    "sam": "number - Serviceable Addressable Market in USD",
    "som": "number - Serviceable Obtainable Market in USD",
    "description": "string - Market description and dynamics"
  },
  "businessModel": "string - How they make money",
  "traction": {
    "revenue": "number - Current revenue (ARR/MRR) in USD",
    "users": "number - Number of users/customers",
    "growth": "string - Growth metrics (e.g., '40% MoM')",
    "customers": ["string - Notable customer names"]
  },
  "team": [
    {
      "name": "string - Founder/team member name",
      "role": "string - Role (CEO, CTO, etc.)",
      "background": "string - Relevant background"
    }
  ],
  "competition": ["string - Competitor names or types"],
  "funding": {
    "asking": "number - Amount being raised in USD",
    "valuation": "number - Valuation or cap in USD",
    "instrument": "string - SAFE, equity, convertible note",
    "useOfFunds": ["string - How funds will be used"]
  },
  "timeline": "string - Key milestones or timeline"
}

Be precise with numbers. Convert to USD if in other currencies.
For market sizes, ensure TAM > SAM > SOM.
Extract ALL team members mentioned, not just founders.
`;

export const DECK_SCORING_PROMPT = `
You are an expert venture capital analyst at a top-tier VC firm. Score this startup based on the extracted information and industry best practices.

STARTUP INFORMATION:
{extracted_data}

SCORING CRITERIA:

1. TEAM (25 points max)
   - Founder experience & domain expertise (0-10)
   - Technical capability to build the product (0-10)
   - Team completeness (tech + business + domain) (0-10)
   - Previous startup/exit experience (0-10)

2. MARKET (25 points max)
   - TAM/SAM/SOM sizing and credibility (0-10)
   - Market growth rate (0-10)
   - Timing - why now? (0-10)
   - Regulatory/macro tailwinds (0-10)

3. PRODUCT (20 points max)
   - Problem clarity & severity (0-10)
   - Solution differentiation (0-10)
   - Technical moat / defensibility (0-10)
   - Product-market fit signals (0-10)

4. TRACTION (20 points max)
   - Revenue / users / growth rate (0-10)
   - Unit economics (CAC, LTV, margins) (0-10)
   - Retention / engagement metrics (0-10)
   - Notable customers / partnerships (0-10)

5. DEAL (10 points max)
   - Valuation reasonableness vs stage/traction (0-10)
   - Use of funds clarity (0-10)
   - Cap table cleanliness (0-10)
   - Terms & investor rights (0-10)

OUTPUT FORMAT (JSON):
{
  "score": "number - Total score out of 100",
  "breakdown": {
    "team": {
      "base": "number - Category score",
      "adjusted": 0,
      "subcriteria": {
        "founderExperience": "number 0-10",
        "technicalCapability": "number 0-10",
        "teamCompleteness": "number 0-10",
        "previousExits": "number 0-10"
      }
    },
    "market": {
      "base": "number",
      "adjusted": 0,
      "subcriteria": {
        "marketSize": "number 0-10",
        "growthRate": "number 0-10",
        "timing": "number 0-10",
        "tailwinds": "number 0-10"
      }
    },
    "product": {
      "base": "number",
      "adjusted": 0,
      "subcriteria": {
        "problemClarity": "number 0-10",
        "differentiation": "number 0-10",
        "defensibility": "number 0-10",
        "pmfSignals": "number 0-10"
      }
    },
    "traction": {
      "base": "number",
      "adjusted": 0,
      "subcriteria": {
        "revenueGrowth": "number 0-10",
        "unitEconomics": "number 0-10",
        "retention": "number 0-10",
        "customers": "number 0-10"
      }
    },
    "deal": {
      "base": "number",
      "adjusted": 0,
      "subcriteria": {
        "valuation": "number 0-10",
        "useOfFunds": "number 0-10",
        "capTable": "number 0-10",
        "terms": "number 0-10"
      }
    },
    "communication": 0,
    "momentum": 0,
    "redFlags": 0
  },
  "strengths": ["string - Key strengths (3-5 items)"],
  "weaknesses": ["string - Key weaknesses/risks (3-5 items)"],
  "questions": ["string - Questions to ask founders (3-5 items)"],
  "summary": "string - 2-3 sentence investment thesis or summary"
}

Be rigorous and objective. Compare against typical standards for the startup's stage.
A pre-seed startup shouldn't be penalized for low revenue if that's stage-appropriate.
Red flags should be noted but factored into the relevant category score.
`;

export function buildDeckExtractionPrompt(deckText: string): string {
  return DECK_EXTRACTION_PROMPT.replace('{deck_text}', deckText);
}

export function buildDeckScoringPrompt(extractedData: unknown): string {
  return DECK_SCORING_PROMPT.replace(
    '{extracted_data}',
    JSON.stringify(extractedData, null, 2)
  );
}
