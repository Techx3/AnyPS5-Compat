# Relay

Cloudflare Worker that receives reports from AnyPS5 Console and files them as issues, so players do not need a GitHub account.

- Validates and trims every report, limits each IP to 30 reports per hour.
- The GitHub token lives only in the Worker as a secret; it can only read and write issues of this repository.

## Deploy (dashboard, no tools needed)

1. GitHub: *Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token*.
   Repository access: *Only select repositories* > `AnyPS5-Compat`. Permissions: *Issues: Read and write*. Copy the token.
2. Cloudflare (free account): *Workers & Pages > Create > Create Worker*, name it `anyps5-compat`, *Deploy*.
3. *Edit code*, replace everything with `worker.js`, *Deploy*.
4. Worker *Settings > Variables and Secrets > Add*: type *Secret*, name `GITHUB_TOKEN`, value the token. *Deploy*.
5. The Worker URL (`https://anyps5-compat.<account>.workers.dev`) goes into `RELAY` in AnyPS5 Console `src/compat.py`.

Check: opening the URL in a browser returns `{"ok":true,...}`.
