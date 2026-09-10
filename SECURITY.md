# Security Policy

## POC scope

Websidian is a contest proof of concept for issue-centered history retrieval. The repository's packaged dataset and public demonstration must use synthetic data only. It is **not approved for production brokerage operations, customer data, employee-sensitive information, credentials, trade secrets, or other confidential company records**.

The current POC does not claim production-grade authorization, data-loss prevention, legal hold, retention, backup, disaster recovery, penetration testing, or an operational service-level agreement.

## Supported versions

| Version                                                                          | Security support                                      |
| -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Current repository default branch and latest submitted POC artifact              | Best-effort review and fixes for reproducible reports |
| Older commits, downloaded archives, forks, and independently exposed deployments | Not supported                                         |

There is no long-term-support release or guaranteed response time for this POC.

## Reporting a vulnerability

Use the repository's **GitHub Security** tab and choose **Report a vulnerability** to start a private GitHub Security Advisory when that feature is available. This is the preferred reporting path because no public security contact is declared for this POC.

Do not publish exploit details, credentials, access tokens, customer information, or confidential company data in a public issue. If private vulnerability reporting is unavailable, do not disclose sensitive reproduction material publicly; use GitHub's repository-owner controls to request that a private advisory channel be enabled.

A useful private report includes:

- the affected commit or submitted artifact and route;
- impact and required preconditions, without real customer or production data;
- minimal reproduction steps using synthetic records;
- redacted logs, screenshots, or request identifiers;
- whether the issue crosses user, authentication, storage, or external-service boundaries;
- a suggested mitigation, if known.

Reports are handled on a best-effort basis. Receipt, triage, remediation, and disclosure timing are not guaranteed by an SLA.

## Secrets and credentials

- Keep OpenRouter and optional GitHub credentials in server-side secret storage only.
- Never commit secrets to source, seed data, tests, screenshots, presentation files, logs, browser storage, or chat messages.
- Never expose secret values in client bundles or API responses.
- If a secret may have been exposed, revoke or rotate it at the provider first, then remove the exposure and review relevant provider logs. Git history removal is not a substitute for rotation.
- Demo and test flows must use synthetic accounts, repositories, and content whose disclosure is authorized.

## Data and AI boundary

- Packaged issue records are synthetic. A public repository or public issue is not automatically approved for external AI processing.
- User-triggered analysis, test-case generation, memory compilation, or semantic indexing can send limited issue excerpts to OpenRouter and an underlying model provider.
- Do not send real company records until information classification, access control, masking, retention/deletion, vendor terms, procurement, and security review are complete.
- AI output is advisory. It must not automatically close an issue, change a source system, deploy code, or become a business decision without an authorized human review.
- A relation, similarity score, or two-hop path is a retrieval aid, not proof of causality or correctness.

## Deployment boundary

The application trusts the user identity header injected and overwritten by the configured Sites authentication gateway. Do not expose a raw Worker, alternate origin, preview endpoint, or proxy path that permits a caller to supply that header directly. A deployment with a different gateway must implement and verify its own authentication and authorization boundary.

D1 storage, rate limiting, and user separation are POC controls. Production use requires a documented threat model, organization-aware authorization, audit and retention rules, backup/recovery, abuse controls, atomic cross-instance limits, security testing, and incident response ownership.

## In scope for responsible disclosure

- authentication or cross-user data-isolation bypass;
- server-secret exposure or client-side credential leakage;
- unauthorized durable writes or external-service calls;
- injection that changes trusted issue content, model context, or rendered output across users;
- bypass of URL, repository, response-size, rate-limit, or request-boundary checks;
- vulnerabilities in Websidian code that can be reproduced against the current POC with synthetic data.

## Out of scope

- social engineering, physical attacks, denial-of-service or load testing;
- testing against real brokerage, company, customer, employee, or third-party data;
- vulnerabilities that exist only in an unsupported fork or authentication-bypassing deployment;
- availability, output quality, pricing, or policy decisions of OpenRouter, GitHub, Cloudflare, or model providers;
- vulnerabilities solely in a third-party service or dependency, which should also be reported to its maintainer through that maintainer's security process.

See `docs/SECURITY_AND_PRIVACY.md` for the POC's detailed trust boundaries and operating limitations.
