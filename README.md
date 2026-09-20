<h1 align="center">Valorant Store Checker</h1>

<p align="center">
  Check your daily Valorant store, Night Market, and bundles — without launching the game.
</p>

<p align="center">
  <a href="https://github.com/diegorv/Valorant-Store-Checker/actions/workflows/ci.yml">
    <img src="https://github.com/diegorv/Valorant-Store-Checker/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI">
  </a>
  <a href="https://github.com/diegorv/Valorant-Store-Checker/pkgs/container/valorant-store-checker">
    <img src="https://github.com/diegorv/Valorant-Store-Checker/actions/workflows/docker.yml/badge.svg?branch=main" alt="Docker image">
  </a>
</p>

> **This repository is a fork.** Valorant Store Checker was created by [Yugam](https://github.com/yugam23) at [yugam23/Valorant-Store-Checker](https://github.com/yugam23/Valorant-Store-Checker). This fork is now developed independently: it does not open pull requests against the original repository, does not track it, and the two projects are expected to diverge over time. See [Credits](#credits).

---

## What it does

Valorant Store Checker is a website that shows what is in your Valorant store right now: the four daily skins, the Night Market when it is on, the featured bundle and your VP balance. Sign in with your Riot account once and check the store from any browser, on your phone or at work, without launching the game.

It also remembers the rotations you have seen, keeps a wishlist and highlights a skin the moment it shows up in your store, and shows your collection, rank and level.

You can use someone's hosted copy or run your own in a few minutes. See [Getting Started](#getting-started).

---

## Features

| Feature               | What you get                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Daily Store**       | The four skins in your rotation today, with prices and rarity tiers                                            |
| **Night Market**      | Your personal Night Market discounts whenever the event is running                                             |
| **Bundles**           | The featured bundle with every item in it, its price and a countdown to when it leaves                        |
| **Wallet**            | Your Valorant Points and Radianite Points                                                                      |
| **Store History**     | Every rotation you have checked, by date, with how often a skin came back and what it cost. Saved to your account, so it is the same on every device |
| **Wishlist**          | Save the skins you want; they are highlighted the moment they appear in your store                             |
| **Collection**        | Every weapon skin you own, with a PDF export                                                                   |
| **Profile**           | Your Riot ID, account level, current rank and RR progress                                                      |
| **Encyclopedia**      | Every weapon skin in the game, filterable by weapon and rarity, no sign-in needed                              |
| **Multiple accounts** | Add more than one Riot account and switch between them                                                         |
| **Stay signed in**    | Sign in with the Riot login link and stay in for about an hour; sign in with your Riot cookies and stay in for up to 30 days |

---

## Your data and how it is protected

This section is for anyone deciding whether to trust the app with their Riot account. The technical details behind each point are in [ARCHITECTURE.md → Security](ARCHITECTURE.md#security).

- **The site never asks for your Riot password.** You log in on Riot's own page, then paste back either the link Riot sends you to or your Riot cookies. The app uses what you paste only to read your store, collection and profile.
- **What is stored on the server.** Your Riot session (the tokens and cookies you pasted, plus your Riot ID and region), your wishlist, and your store history: one record per day you open the store, with the four skins and their prices, so it follows your account across devices. The session is encrypted with a key only the host has, so a copy of the database is useless without it. Sessions expire on their own: tokens are refreshed about every hour, a session that can no longer be refreshed is deleted, and no session lives longer than 30 days.
- **What stays in your browser.** Only an anonymous session ID in a cookie that page scripts cannot read. Clearing the site's data signs you out and nothing else.
- **Signing out is immediate.** Logging out deletes your session from the server right away. It does not touch your Riot account, and the cookies you pasted stay valid at Riot until they expire there.
- **Who else is contacted.** Your store, wallet and collection come straight from Riot's servers, using the session you pasted. Rank and level come from [HenrikDev](https://docs.henrikdev.xyz), a public Valorant stats API, which is only sent your player ID and region, never your session. Skin images and names come from [valorant-api.com](https://valorant-api.com). Nothing else is contacted, and there is no analytics or tracking.
- **Protection against abuse.** Sign-in attempts are rate limited per IP address, every page is served with strict browser security headers, and production instances only work over HTTPS.
- **Host it yourself.** If you would rather not trust someone else's server with your Riot session, [HOSTING.md](HOSTING.md) shows how to run your own copy on Vercel or with Docker, with the same protections.

> **Disclaimer:** This project is not affiliated with Riot Games. Usage is subject to Riot's Terms of Service. Credentials are only used to authenticate directly with Riot's servers — they are never stored or logged.

---

## Getting Started

- **Host it yourself** → [HOSTING.md](HOSTING.md): self-hosting with Docker Compose, deploying to Vercel, and the environment variables reference.
- **Work on the code** → [DEVELOPMENT.md](DEVELOPMENT.md): local setup, the unit, end-to-end and mutation test suites, and the project layout.
- **Understand how it works** → [ARCHITECTURE.md](ARCHITECTURE.md): tech stack, request flow, authentication, security measures and the patterns the code relies on.

---

## Credits

This project is a fork of [yugam23/Valorant-Store-Checker](https://github.com/yugam23/Valorant-Store-Checker), created by [Yugam](https://github.com/yugam23). The original idea, design, architecture and the bulk of the feature set are their work. Thank you.

The fork is maintained separately by [diegorv](https://github.com/diegorv) and follows its own direction:

- Changes made here are **not** submitted upstream as pull requests, and upstream changes are not merged back automatically.
- Bugs and feature requests about this fork belong in [this repository's issues](https://github.com/diegorv/Valorant-Store-Checker/issues). Anything about the original project belongs in the [original repository](https://github.com/yugam23/Valorant-Store-Checker/issues).

---

## License

The original repository does not ship a license file, and neither does this fork. Until one is added, the code is covered only by GitHub's default terms: you may view and fork it, but no other rights are granted. Copyright in the original work remains with its author (see [Credits](#credits)).
