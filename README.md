# Bajaj Finance Hackathon API

This project implements a highly accurate, webhook-accessible API for insurance policy clause retrieval and reasoning, as required for the Bajaj Finance Hackathon.

## Features
- Accepts URLs to PDF, DOCX, or EML documents
- Extracts and chunks text for semantic search
- Uses OpenAI embeddings and GPT-4 for clause retrieval and reasoning
- Returns structured, explainable JSON answers
- Designed for deployment on Vercel (Next.js API Route)

## Usage
- POST to `/api/v1/hackrx/run` with:
  ```json
  {
    "documents": "https://url-to-policy.pdf",
    "questions": ["What is the grace period?", "Does this cover cataract surgery?"]
  }
  ```
- Receives:
  ```json
  {
    "answers": [
      { "decision": "Approved", ... },
      { "decision": "Not covered", ... }
    ]
  }
  ```

## Environment Variables
- `OPENAI_API_KEY`: Your OpenAI API key

## Deployment
- Deploy directly to Vercel for webhook access

---
