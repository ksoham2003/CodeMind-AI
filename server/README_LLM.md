LLM Configuration

This project uses the GROQ SDK to call LLM models. If you encounter `model_not_found` errors, set a model you have access to in the server environment variables.

Recommended environment variables (see `.env.example`):

- `GROQ_API_KEY`: Your provider API key.
- `LLM_MODEL`: Primary model to use (example: `gpt-4o-mini`, `gpt-4o`, `gpt-4`).
- `LLM_FALLBACK_MODEL`: Optional fallback model to try when the primary model is unavailable.

If you see errors like `The model \`gpt-4o-mini\` does not exist or you do not have access to it`, update `LLM_MODEL` to a model shown as available in your provider account.

If you don't have access to any models on GROQ, you can:
- Request access from the provider or use a different provider with valid credentials.
- Configure `LLM_FALLBACK_MODEL` to a model you do have access to.

After updating environment variables, restart the server:

```bash
cd server
npm run dev
```

If you need help determining which model names are valid, check the provider's model list in their dashboard or contact their support.
