# PreviewPilot demo app

A tiny Next.js (App Router) app deployed on Vercel. It gives `pr-verify` a real production URL and a real preview URL per PR to compare.

- Routes: `/`, `/pricing`
- Vercel project root directory: `examples/demo-app`

To test the verifier, open a PR that changes this app (for example, break the pricing grid on mobile) and run:

```bash
pr-verify --base <production-url> --preview <preview-url> --routes /,/pricing
```
