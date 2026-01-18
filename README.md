# crowgent-openapi

Generate OpenAPI specs from your backend code using AI.

## Installation

```bash
npm install -g crowgent-openapi
```

Or use directly with npx:

```bash
npx crowgent-openapi ./src/routes -o openapi.yaml
```

## Usage

```bash
# Set your OpenAI API key
export OPENAI_API_KEY=sk-...

# Generate spec from your backend
crowgent-openapi ./backend/routes -o openapi.yaml

# Specify base URL
crowgent-openapi ./src -o api.yaml --base-url https://api.example.com

# Use a different model
crowgent-openapi ./src -o api.yaml --model gpt-4o
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <file>` | Output file path | `openapi.yaml` |
| `-k, --api-key <key>` | OpenAI API key | `$OPENAI_API_KEY` |
| `-m, --model <model>` | Model to use | `gpt-4o-mini` |
| `--base-url <url>` | API base URL | `http://localhost:3000` |

## Supported Frameworks

Works with any backend - the AI understands:
- Express.js / Node.js
- Next.js API routes
- FastAPI / Flask / Django
- Go / Gin / Chi
- Ruby on Rails
- And more...

## How It Works

1. Scans your source files (`.ts`, `.js`, `.py`, etc.)
2. Sends code to GPT-4o-mini for analysis
3. Returns a complete OpenAPI 3.0 spec

Typical cost: **~$0.002 per scan** (less than a penny).

## License

MIT

