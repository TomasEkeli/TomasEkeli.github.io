---
layout: post
title: "Setting Up a New Windows PC"
date: 2023-12-11 12:00
category: productivity
author: Tomas Ekeli
tags: [windows, workflow, productivity]
excerpt: Setting up a new computer can be a bit of a chore, this is my list of things I always set up on a new Windows PC.
main-image: /assets/img/2023-12-11-setting-up-a-new-windows-pc-my-personal-workflow.webp
main-image-alt: A new computer setup with various applications
---

# Setting Up a New Windows PC

![{{ page.main-image-alt }}]({{ page.main-image }})

Setting up a new Windows PC can be a blend of excitement and challenge. For me, it's about creating a familiar environment where productivity meets efficiency. Here's my guide on how I like to set up a new Windows machine, focusing on essential tools and personal preferences.

## Starting with the Browser: Firefox

### The Gateway to the Web: Firefox
My setup journey begins with Firefox, my preferred internet browser. It's known for its speed, privacy, and customization options. Other options are out there, but I try to stay away from Google and Microsoft's browsers. And, since they started going into the crypto bullshit I no longer want to touch Brave. For me, it should be some sort of a Firefox. There are other variants of Firefox out there, but I prefer the original on Windows.

There are two ways to install [Firefox](https://getfirefox.com)

- Use the command line for a swift installation: `winget install firefox.firefox`.
- Or, use Edge to download it from [https://getfirefox.com](https://getfirefox.com) then set it as the default browser without importing old data.

### Essential Utilities

After setting up the browser, I focus on essential utilities to streamline my workflow. The first things I need to even be able to install other things and connect to my data are:

- **[7-Zip](https://7-zip.org/)**: A file archiver known for its high compression ratio. Install command: `winget install 7zip.7zip`.
- **[CopyQ](https://hluk.github.io/CopyQ/)**: An advanced clipboard manager that stores more than the default number of clipboard entries. I do not want to compute without something like this. Install command: `winget install hluk.copyq`.
- **[KeePassXC](https://keepassxc.org/)**: A secure password manager to keep all credentials safe. Its database syncs across various cloud services for accessibility. Installation and setup involve:
  - `winget install keepassxcteam.keepassxc`.
  - Open my database-file with it - that's stored on several cloud providers and on my phone. This database is encrypted with the one password I must remember - it is a pretty long and gnarly one.
  - Custom settings for startup behavior and browser integration.
    - Activate auto-launch on startup, minimised to tray
    - Minimise-on-exit (don't close)
    - Hide to system-tray when minimised
    - Activate browser integration
      - For firefox, install the [KeePassXC-Browser](https://addons.mozilla.org/en-US/firefox/addon/keepassxc-browser/).
- **[Joplin](https://joplinapp.org/)**: A note-taking application that synchronizes with cloud storage for easy access to notes. Installation and setup involve syncing with the cloud storage for note retrieval, but all my notes are then available on all my devices, encrypted and safe - so the cloud-provider cannot read them. I use Joplin extensively, and find it to be a great tool.
  - `winget install joplin.joplin`

## Customizing Firefox

Firefox isn't just a browser for me; it's a customized tool that enhances my browsing experience.

- **Sync**: I use the sync feature with my email for seamless access across devices.
- **Extensions**: I use add-ons to give Firefox new capabilities, and redirect it to privacy-friendly alternatives. A few of the most important extensions are:
  - [KeePassXc-Browser](https://addons.mozilla.org/en-US/firefox/addon/keepassxc-browser/) makes logging into the myriad of sites easy and secure. I don't think I remember any site passwords other than my master password anymore, and neither should you.
  - [FirefoxPWA](https://addons.mozilla.org/en-US/firefox/addon/pwas-for-firefox/) lets me run web-apps as native applications with Firefox.
    - `winget install -e Microsoft.VcRedist.2015+.x64`
    - `winget install mozillafirefoxpwa`.
  - [LibRedirect](https://addons.mozilla.org/en-US/firefox/addon/libredirect/) lets me redirect mainstream sites to privacy-friendly alternatives. I use it to redirect YouTube to my own Invidious instance, Google Maps to OpenStreetMap, etc.
  - [NoScript](https://addons.mozilla.org/en-US/firefox/addon/noscript/): I have sites I trust, for everything else I want to decide if I want to run scripts or not. This is a bit of a hassle, but it's worth it, removes all cookie-popups and sign-up pop-overs.
  - [uBlock Origin](https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/): I use this to block ads and trackers. I am against being sold by ad-networks, and it's getting downright dangerous to browse the web without an ad-blocker.
  - [Privacy Badger](https://addons.mozilla.org/en-US/firefox/addon/privacy-badger17/): I use this to block trackers and fingerprinting. Worth it.
  - [Joplin Web Clipper](https://addons.mozilla.org/en-US/firefox/addon/joplin-web-clipper/): I use this to save web-pages to my Joplin notes. Don't do it a lot, but sometimes it's a time-saver.
  - [Dark Reader](https://addons.mozilla.org/en-US/firefox/addon/darkreader/): I use this to make sites dark. I like dark sites, and this is a great way to get most pages to not blind me.
  - [Omnivore](https://addons.mozilla.org/en-US/firefox/addon/omnivore/): It's like Pocket or ReadItLater, but it's open-source and I can host it myself. I use it to save articles for later reading. I use this a lot, for when I find interesting things I don't have time to read right now.
  - [User-Agent Switcher and Manager](https://addons.mozilla.org/en-US/firefox/addon/user-agent-string-switcher/): I use this to change my user-agent, when bad web-devs (there, I said it) block Firefox by the user-agent. I don't like it, but it's a fact of life (bad devs exist).
  - [Modify Header Value](https://addons.mozilla.org/en-US/firefox/addon/modify-header-value/): I use this to change my request headers. A bit of a developer-tool for when I use APIs that require a specific header. I don't use it a lot, but it's nice to have.
  - [Open in Reader View](https://addons.mozilla.org/en-US/firefox/addon/reader-view/): Reader view is a wonderful feature that strips away all the cruft and lets me read the article without distractions. This add-on lets me open links in reader view with a right-click.
  - [Right-Click Borescope](https://addons.mozilla.org/en-US/firefox/addon/right-click-borescope/): This is a true gem - it lets you find the images you clicked on even if they are hidden under layers of divs. I never have to go into the dev-tools to find the image I want to save again.
  - [Add custom search engine](https://addons.mozilla.org/en-US/firefox/addon/add-custom-search-engine/): Makes it real easy to add new search-engines to Firefox. I use this to add my own Searx-instance as a search-engine, and others. That so many people just use Google is sad, I don't even think it's a very good search engine anymore. I use Searx, but ther are lots of others out there.
  - [SimpleLogin](https://addons.mozilla.org/en-US/firefox/addon/simplelogin/): I use this to create disposable email-addresses for sites that require an email-address. I don't want to give my email-address to every site out there, and I don't want to use my work-email for personal stuff. This is a great way to get around that. With the integrated password manager I don't even need to remember the account I set up for a site, and since I'm a paying customer of ProtonMail I get SimpleLogin with my account there.

- **Search Engine**: Adding a privacy-focused search engine as the default one in Firefox enhances my browsing privacy. I have my own instance of [Searx](https://en.wikipedia.org/wiki/Searx) that I run for me and my family. So, I set that as my default search engine in Firefox.

## Cloud Services for Seamless Sync

Cloud storage is integral to accessing files and databases on any device.

- **[Nextcloud](https://nextcloud.com/)**: A secure cloud storage solution that I use to access files and the password database. It's also where my personal calendar and address-book lives. You can use this for a lot of things, and you can host it yourself if you want. Install command for the client-software: `winget install nextcloud.nextclouddesktop`.
- **[Proton Services](https://proton.me/)**: For secure email, file-storage and VPN services, I use and pay for Proton. There are other good providers out there, but this is among the better ones. Installation can be done through Winget commands or directly from their website.
  - `winget install proton.protondrive` - like Dropbox, but secure.
  - `winget install protontechnologies.protonmailbridge` - a Bridge that lets Thunderbird connect to ProtonMail through a small, local IMAP-server.
  - `winget install protontechnologies.protonvpn` - a VPN-service that I use when I'm on public networks, or when I want to access content that is blocked in my country.

## Email and Calendar Management: Thunderbird

Thunderbird is my go-to for managing emails and calendars. I don't absolutely adore it, although it's gotten much better, but it's far better than Outlook.

- Install [Thunderbird](https://www.thunderbird.net/) using `winget install mozilla.thunderbird`.
- Add-ons like Dark Reader and calendar integrations enhance functionality.
- As my various places of work have tended to use Microsoft Exchange, and that has a spotty record of supporting IMAP and CALDav, I have used [DavMail](https://davmail.sourceforge.io/) to connect to Exchange. But, in recent years I have switched over to the (paid) extension [Owl for Exchange](https://www.beonex.com/owl/). It's extremely easy to set up and works flawlessly. I highly recommend it! Well worth the money.
- I have my personal calendar on my Nextcloud-instance, and I use the [Lightning](https://www.thunderbird.net/en-US/calendar/) extension to connect to it. Works great, and I can share my calendar with my family. I tried using [Proton Calendar](https://protonmail.com/blog/protoncalendar-beta-announcement/) for a while, but it doesn't support anything but their web-interface and their own apps. I want to use my own calendar-app, so I switched back to my Nextcloud-calendar.

## Development: VSCode

As a developer, an efficient coding environment is crucial. I use VSCode for my development needs. People tell me I should use VSCodium, to get rid of the telemetry. I agree, but I'm not willing to give up the extensions.

- **[VSCode](https://code.visualstudio.com/)**: A versatile code editor with extensions for various programming languages. Install command: `winget install microsoft.visualstudiocode`. I really should make a post on the extensions I use, but that's for another day.
- **[Fira Code](https://github.com/tonsky/FiraCode)**: A monospaced font with programming ligatures for a better coding experience. Install command: `winget install nerdfonts.firacode`.
- These days I do all my development in Docker-containers - so I keep my computer (the host-machine) as clean as possible. I don't install any SDKs, or development tools on it, and never have conflicts between them anymore.

## Command-Line Efficiency: Git and PowerShell

For version control and scripting, I rely on Git and PowerShell on the Windows -machine.

- **[Git](https://gitforwindows.org/)**: Essential for version control, installed using `winget install git.git`.
  - When I still did development on my host-machine, I used [GitExtensions](https://gitextensions.github.io/) to get a nice GUI for Git. If you're developing directly on Windows I would recommend it: `winget install gitextensions.gitextensions`.
- **[PowerShell](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows?view=powershell-7.4)**: Enhanced with Oh My Posh and other modules for a powerful scripting experience. Customized with a [profile script](https://gist.github.com/TomasEkeli/19d029631b2f8d75e15547872409f6ae) and an [oh-my-posh configuration-file](https://gist.github.com/TomasEkeli/e06c29e4300596a9f99bf3f2b81ce728) for a personalized touch.
  - Also needs a font that supports the glyphs used by oh-my-posh, I use [CascadyiaCove NF](https://github.com/ryanoasis/nerd-fonts/releases/download/v2.1.0/CascadiaCode.zip) for this. Remember to change the WinTerm default font to this one, or the shell will look garbled.
  - This is based on and slightly modified from the setup shared by Scott Hanselman in his [blog post](https://www.hanselman.com/blog/my-ultimate-powershell-prompt-with-oh-my-posh-and-the-windows-terminal).

## Integrating Linux: Windows Subsystem for Linux (WSL)

Bringing Linux into Windows adds versatility to my setup. I do all my development, and much of my other work from Linux under windows. For many things it's just a nicer experience.

- Activate Hyper-V and install a preferred Linux distro with WSL for Linux environment support on Windows.
  - `wsl --install` - this will install the latest Ubuntu LTS, and set it up for you.

## Final Touches: Office, Docker, and Communication Tools

To round up the setup:

- **[LibreOffice](https://www.libreoffice.org/)**: For handling office documents, installed via `winget install libreoffice`. I know most people prefer Microsoft Office, but I don't.
- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)**: Essential for containerization projects. I keep meaning to try out alternatives like [PodMan](https://podman.io/) or [Rancher](https://rancherdesktop.io/), but Docker just keeps on working for me. Requires WSL to be installed and activated. Install command: `winget install docker.dockerdesktop`
- **[ReMarkable](https://remarkable.com)**: For integration with my paper-tablet. I use it for note-taking and sketching. I have a ReMarkable 2, and I love it. I use it for all my note-taking, and for sketching out ideas, and reading. Installed via `winget install remarkable.remarkable`
- Communication tools for staying connected with teams and communities.
  - **[Teams](https://teams.microsoft.com/)**: For work-related communication. Not very good for chat, but excellent for video-meetings. Installed via `winget install microsoft.teams`.
  - **[Slack](https://slack.com/)**: For work and community-related communication. Much better than Teams for chats and channels as well as informal video-meetings, but not nearly as good for "real meetings". Installed via `winget install slacktechnologies.slack`.
  - **[Discord](https://discord.com/)** For more community-related communication. Installed via `winget install discord.discord`.
  - **[Element](https://element.io/)**: For community-related communication over the [Matrix protocol](https://spec.matrix.org/latest/). There are lots of other cool clients for Matrix, but I like Element. I wish more people would use Matrix. Installed via `winget install element.element`.

By following these steps, I ensure that my new Windows PC is not just a machine, but a personalized workspace that aligns with my workflow and preferences. It's all about creating a space where productivity is effortless and secure.

It's quite a lot, and it does take a while to set up. Following this guide gets me far pretty quickly, though, and I can get back to work in a few hours. I hope it helps you too!