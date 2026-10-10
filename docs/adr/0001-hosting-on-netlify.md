# ADR 0001: Host the new Next.js site on Netlify's free plan

- **Status:** Accepted
- **Date:** 2026-10-10
- **Decided by:** Kudzai

## Context

The site is moving from a single HTML file on GitHub Pages to a Next.js app. That needs a host that runs server code (for item link previews and webhooks) and gives every change its own preview link so Sian can test it. We are pre-launch and want to spend nothing until we have to.

## Options considered

| Option | Cost | Commercial use | Collaborators | Notes |
|---|---|---|---|---|
| Netlify Free | $0 | Allowed, per Netlify staff | Public-repo contributors free | 300 credits a month, hard cap: the site pauses rather than billing |
| Vercel Hobby | $0 | Not allowed: non-commercial personal use only | No team seats | Would have to move to Pro before payments or adverts |
| Vercel Pro | $20 a month per developer | Allowed | Viewer seats free | Best Next.js support, since Vercel makes Next.js |

## Decision

Use Netlify's free plan. Move to Netlify Personal ($9 a month) if we outgrow the credits.

## Consequences

- The current site stays on GitHub Pages until the switch-over (build order step 7).
- Prefer static pages where possible, because server-rendered pages use more credits.
- Next.js runs through Netlify's adapter, so brand-new Next.js features may reach Netlify later than Vercel.

## Sources

- [Netlify pricing](https://www.netlify.com/pricing/)
- [Netlify Next.js support](https://docs.netlify.com/frameworks/next-js/overview/)
- [Netlify staff answer on commercial use](https://answers.netlify.com/t/can-we-use-netlify-free-plan-for-commercial-purposes/41545/2)
- [Vercel fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)
