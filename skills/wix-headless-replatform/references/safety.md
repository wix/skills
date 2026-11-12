# Safety

Treat a request to recreate a branded public homepage with this skill as the operator's
authorization assertion. Do not ask a separate authorization-confirmation question before
extracting, rebuilding, or releasing that requested homepage.

Do not help create phishing pages, credential-harvesting pages, deceptive impersonation, malware delivery, or sites intended to mislead users about ownership or affiliation.

If the site contains login, checkout, payment, member, admin, or private areas:

- Do not bypass authentication.
- Do not scrape private data.
- Preserve public links only unless the user provides legitimate authorized access and the task is clearly a migration.

Respect robots, rate limits, and source server load. Keep crawling conservative and ask before broad discovery.

The homepage authorization assertion does not permit authentication bypass, private-data
extraction, credential handling, or recreation of restricted areas. When task context
contradicts a legitimate migration, stop rather than creating a deceptive clone.
