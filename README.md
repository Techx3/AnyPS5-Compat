# AnyPS5 Compatibility

Compatibility list for games run with [AnyPS5](https://github.com/boykopovar/AnyPS5) through [AnyPS5 Console](https://github.com/Techx3/AnyPS5-Console).

**List:** https://techx3.github.io/AnyPS5-Compat/

## How it works

1. In AnyPS5 Console, turn on *Settings > Compatibility reports* and sign in with GitHub (one time, with a code).
2. Every time a game ends or fails, the console sends a report. The first report of a game opens an issue titled `[TITLE_ID] Name`; later reports are comments on it. A report is only sent when something changed (status, AnyPS5 version, missing functions).
3. A GitHub Action reads all reports, labels each issue with its status and publishes the list on GitHub Pages.

Paths and user names are removed from the log before sending. At 2 and 10 minutes the console takes a screenshot of the game window only; they are stored in the `shots` branch.

## Status

| Status | Meaning |
|---|---|
| Does not convert | AnyPS5 could not convert the game |
| Does not boot | No game window appeared |
| Boots | Window, closed or crashed in under 2 minutes |
| In game | 2 to 10 minutes |
| Playable | 10 minutes or more in one session |

## Files

- `scripts/build.py`: reads the issues and writes `site/compat.json`.
- `site/`: the page.
- `.github/workflows/pages.yml`: runs on every issue or comment, daily and on push.
