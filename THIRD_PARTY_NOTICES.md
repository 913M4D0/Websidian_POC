# Third-Party Notices

## Scope and verification boundary

This inventory covers Websidian's **direct npm dependencies**, separately lists external services and reference-only materials, and is intended to make the POC's provenance auditable.

- Generated from `package.json`, `package-lock.json`, and the installed packages' `package.json` metadata on 2026-09-10.
- `package-lock.json` SHA-256: `96abe0e100d52b8e3dc5fd3c057c6e0b59b55f4dc4ed65a365204f26ee74b8ce`.
- Versions below are installed versions, not only the version ranges declared in `package.json`.
- License values are SPDX expressions reported by package maintainers. A dual-license expression such as `MIT OR Apache-2.0` permits a choice under the upstream terms; it does not mean both licenses must be combined.
- Transitive packages are locked in `package-lock.json` but are not repeated in this human-readable direct-dependency table. Their upstream copyright notices and license files remain authoritative.

This is an automated inventory, **not legal advice or a completed legal review**. Before production distribution, the distributor must verify the exact shipped artifact, all transitive licenses, required copyright notices, external-service terms, and company policy. No project-level `LICENSE` grant is implied by this file.

## Direct runtime dependencies

| Package                    | Installed version | Declared license |
| -------------------------- | ----------------: | ---------------- |
| `@base-ui/react`           |             1.7.0 | MIT              |
| `@shadcn/react`            |             0.3.0 | MIT              |
| `3d-force-graph`           |            1.80.0 | MIT              |
| `class-variance-authority` |             0.7.1 | Apache-2.0       |
| `clsx`                     |             2.1.1 | MIT              |
| `cmdk`                     |             1.1.1 | MIT              |
| `date-fns`                 |             4.1.0 | MIT              |
| `drizzle-orm`              |            0.45.2 | Apache-2.0       |
| `embla-carousel-react`     |             8.5.2 | MIT              |
| `input-otp`                |             1.4.2 | MIT              |
| `lucide-react`             |            1.31.0 | ISC              |
| `react`                    |            19.2.6 | MIT              |
| `react-day-picker`         |             9.8.1 | MIT              |
| `react-dom`                |            19.2.6 | MIT              |
| `react-resizable-panels`   |             4.5.8 | MIT              |
| `react-server-dom-webpack` |            19.2.6 | MIT              |
| `recharts`                 |             3.8.0 | MIT              |
| `shadcn`                   |            4.18.0 | MIT              |
| `tailwind-merge`           |             3.6.0 | MIT              |
| `three`                    |           0.185.1 | MIT              |
| `three-spritetext`         |            1.10.0 | MIT              |
| `tw-animate-css`           |             1.4.0 | MIT              |
| `vinext`                   |      1.0.0-beta.5 | MIT              |

The graph presentation depends primarily on `three`, `3d-force-graph`, and `three-spritetext`; UI rendering depends primarily on React and the listed component/style packages. The table reports licensing only and does not claim upstream endorsement.

## Direct development dependencies

| Package                     | Installed version | Declared license  |
| --------------------------- | ----------------: | ----------------- |
| `@cloudflare/vite-plugin`   |            1.37.1 | MIT               |
| `@cloudflare/workers-types` |      4.20260515.1 | MIT OR Apache-2.0 |
| `@openai/sites-vite-plugin` |             0.2.0 | MIT               |
| `@tailwindcss/postcss`      |             4.2.1 | MIT               |
| `@types/node`               |          22.19.19 | MIT               |
| `@types/react`              |           19.2.14 | MIT               |
| `@types/react-dom`          |            19.2.3 | MIT               |
| `@types/three`              |           0.185.4 | MIT               |
| `@vitejs/plugin-react`      |             6.0.2 | MIT               |
| `@vitejs/plugin-rsc`        |            0.5.26 | MIT               |
| `drizzle-kit`               |           0.31.10 | MIT               |
| `oxfmt`                     |            0.61.0 | MIT               |
| `oxlint`                    |            1.76.0 | MIT               |
| `oxlint-tsgolint`           |          7.0.2001 | MIT               |
| `tailwindcss`               |             4.2.1 | MIT               |
| `typescript`                |             5.9.3 | Apache-2.0        |
| `vite`                      |            8.0.13 | MIT               |
| `wrangler`                  |            4.92.0 | MIT OR Apache-2.0 |

Common license texts are available from the [MIT License](https://opensource.org/license/mit), [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), and [ISC License](https://opensource.org/license/isc-license-txt). Package-specific copyright notices and bundled license files take precedence.

## External services and hosted capabilities

These are **services or model endpoints**, not bundled open-source dependencies. Their provider terms, privacy policies, availability, pricing, and data-processing conditions apply separately.

| Service                                      | Websidian use                                                                    | Boundary                                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| OpenRouter                                   | User-triggered chat-completion and embedding gateway                             | Selected issue context may be sent externally only when the user invokes an AI feature; server credentials must remain secret.   |
| `openai/gpt-5.6-luna` through OpenRouter     | Issue analysis, test-case generation, and derived-memory compilation             | Model ID is runtime-validated; provider routing and availability are governed by OpenRouter and the underlying provider.         |
| `qwen/qwen3-embedding-8b` through OpenRouter | Optional semantic indexing of completed-issue excerpts                           | This is an external model call, not a locally distributed model or weight license.                                               |
| GitHub REST API                              | Optional, user-initiated, one-way issue/comment snapshot import                  | Websidian does not close or edit the source GitHub issue; repository access and content rights remain the user's responsibility. |
| Cloudflare Workers and D1 / Sites gateway    | POC hosting, authentication boundary, server runtime, and per-user persistence   | Cloud service terms apply. The POC must not be exposed through an origin that bypasses the trusted authentication gateway.       |
| ChatGPT / Codex                              | Assistance with ideation, research, UI, implementation, tests, and documentation | Development assistance is disclosed separately; generated suggestions were subject to human selection and verification.          |

Operational details and data boundaries are documented in `docs/AI_USAGE_DISCLOSURE.md`, `docs/SECURITY_AND_PRIVACY.md`, and `docs/SYNTHETIC_DATA_STATEMENT.md`.

## Reference-only materials

The following informed the problem framing or presentation. They are not listed in `package.json`, and this inventory does not claim that their code was incorporated.

| Reference                                                                                   | How it was used                                                                                                                      |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [Microsoft GraphRAG overview](https://microsoft.github.io/graphrag/)                        | Conceptual reference for the “connect the dots” information-retrieval problem. Websidian is not a Microsoft GraphRAG implementation. |
| [Microsoft GraphRAG Local Search](https://microsoft.github.io/graphrag/query/local_search/) | Conceptual reference for expanding from an entity to nearby relationships and source records.                                        |
| [GraphRAG reference video](https://www.youtube.com/watch?v=mAekyqd561w)                     | Presentation-flow reference supplied for the contest narrative. The publisher's terms and copyright remain applicable.               |

## Maintenance

Regenerate and review this inventory whenever `package.json` or `package-lock.json` changes. A release or submission should be associated with an immutable commit or archive hash; a working tree with local changes cannot be reproduced from a commit identifier alone.
