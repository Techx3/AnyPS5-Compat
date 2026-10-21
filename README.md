# AnyPS5 Compatibility

Compatibility list for games run with [AnyPS5](https://github.com/boykopovar/AnyPS5) through [AnyPS5 Console](https://github.com/Techx3/AnyPS5-Console).

**List:** https://techx3.github.io/AnyPS5-Compat/

## How it works

1. AnyPS5 Console sends a report when a game ends or fails to convert (on by default, no account needed; *Settings > Compatibility reports* turns it off).
2. The report goes to a small relay ([`relay/`](relay)) that files it here: the first report of a game opens an issue titled `[TITLE_ID] Name`, later reports are comments on it. One game = one entry.
3. A GitHub Action ([`pages.yml`](.github/workflows/pages.yml)) reads every report, labels each issue with its status and publishes the list on GitHub Pages, about a minute after each report.

The console only sends a report when something changed for that game (status, AnyPS5 version, missing functions, screenshots).

## Status

| Status | Meaning |
|---|---|
| Does not convert | AnyPS5 failed to convert the game |
| Does not boot | No game window appeared |
| Boots | Game window, under 2 minutes |
| In game | 2 to 10 minutes, or longer but it crashed |
| Playable | 10 minutes or more in one session without crashing |

A session that ends with a non-zero exit code that the player did not cause is a crash and is never *Playable*.

**Official vs fork:** official AnyPS5 is a stable release or `boykopovar/AnyPS5` main without local changes. When a game's best result was reported on a fork or a modified build (main with local commits) and not on official AnyPS5, the page tags it **not tested on main/release**, or shows the best official result next to it (for example *main/release: Boots*). It does not mean the game fails on main; it was just not confirmed there.

## What a report contains

- Title ID, name and game version.
- AnyPS5 channel and commit (or release tag) and console version.
- Minutes played, exit code, whether the player closed the game.
- Missing system functions from the console's function check and where the game stops.
- Error lines from the whole log plus its last lines; paths and user names are removed.
- Screenshots of the game window at 2 and 10 minutes (stored in the [`shots`](../../tree/shots) branch).
- Windows version, GPU name and an anonymous random ID per installation.

The full report is kept as JSON in an HTML comment at the end of each issue or comment.

## The page

- Every game with its current status, best result, AnyPS5 version and last report, with search and status filters.
- Details per game: crash reason and exit code, missing functions, log errors, last log lines, screenshots, links to the issue and the report.
- *Most needed functions*: functions missing for the most games, from each game's latest report.

## Maintaining

- **Invalid report:** close the issue as *not planned*. Reports in it are ignored; reports sent after closing count again.
- **Duplicate issues** for the same title ID are merged on the page automatically.
- **Unwanted screenshot:** delete it from the `shots` branch.
- **Relay token** (fine-grained, *Issues* and *Contents* read/write on this repository only) expires: create a new one and replace the `GITHUB_TOKEN` secret of the Worker. See [`relay/README.md`](relay/README.md).

## Files

- `scripts/build.py`: reads the issues and writes `site/compat.json`, sets the status labels.
- `site/`: the page.
- `relay/worker.js`: Cloudflare Worker that receives reports and screenshots.
- `.github/workflows/pages.yml`: runs on every issue or comment, daily and on push.
