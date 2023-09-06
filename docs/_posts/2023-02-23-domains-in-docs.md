---
layout: post
title: "Domains in docs"
date: 2023-02-23 12:00:00 +01:00
author: "Tomas Ekeli"
permalink: 2023/02/domains-in-docs/
categories: [meta, web, documentation]
excerpt: "Do not use real domains or ip-addresses in your documentation!"
main-image: /assets/img/2023-02-23-domains-in-docs.webp
main-image-alt: "looking up towards bookshelves with books in a modern library with a glass roof"
---
![{{ page.main-image-alt }}]({{ page.main-image }})

When writing technical documentation – do not use real URLs or IP -addresses. If you come up with your own or use some you’ve seen in other documentation they may lead to somewhere real. They may not yet, but maybe in the future.

For example I sometimes see documentation use the domains `contoso.com` or `adventure-works.com` – these are actually fictional companies made up by Microsoft for their own documentation -purposes. The contoso -domain redirects to Microsoft at the time of writing, but it seems a real company currently resides at adventure-works. I hope they like getting spurious requests from irrelevant documentation.

When you add your examples with URLs that will get picked up by people and machines, and they will request those addresses from the internet. This will at best be a needless overhead for the internet and whoever had the “good luck” of owning the domain you’re using, at worst it can be a vector for all sorts of nastiness.

You can use your own domain-name for examples, if you want to burn CPU and Network for no reason at all. And, you’ll never safely get to dump that domain-name after some name-change or merger.

## Safe domain

Luckily there is a [reserved domain-name](https://www.rfc-editor.org/rfc/rfc2606.html#section-3) you should **always** use in documentation: `example.com` (or `.net`/`.org`)

This domain is reserved for documentation, and DNS -resolving software knows (should know) not to even attempt to resolve it.

## Safe TLD

If you need to use a top-level-domain (instead of `.com`) in your documentation there are [4 reserved](https://www.rfc-editor.org/rfc/rfc2606.html#section-2) for you:

- `.test`
- `.example`
- `.invalid`
- `.localhost`

These will also not resolve to anything, won’t even try. So they are safe to use in your documentation.

_As an aside: many use the top-level-domain `.local` for their local network – that’s actually for multicast and shouldn’t be used. There is a [reserved domain](https://www.rfc-editor.org/rfc/rfc8375.html) that you are supposed to use internally if you don’t have a **real** domain: `home.arpa`_

## Safe IP -addresses

What about IP -addresses? When you need to use them in documentation – are there safe ones? You might think the loopback-address, 127.0.0.1, would be safe? Think again – since that actually goes somewhere (the current machine) you might reach something there. It might cause things to happen. It’s just not a good idea.

This is why we also have reserved ranges of IP -addresses. These will not go anywhere and will be stopped at the network-layer of whatever computer requests them. This makes them safe to use. To be able to document calls between different networks there are [three reserved blocks](https://www.rfc-editor.org/rfc/rfc5737.html#section-3):

- `TEST-NET-1: 192.0.2.0/24`
- `TEST-NET-2: 198.51.100.0/24`
- `TEST-NET-3: 203.0.113.0/24`

That “`/24`” is [CIDR-notation](https://en.wikipedia.org/wiki/Classless_Inter-Domain_Routing#CIDR_notation) and it means that all values after the last period are included – so all IP -addresses from `192.0.2.1` to `192.0.2.255` are included in `192.0.2.0/24`

There’s also IP6, right – and there we also have a [reserved block of IP -addresses](https://www.rfc-editor.org/rfc/rfc3849). And it is **big**! All IP6 addresses that start with 2008:bd8…. are documentation-addresses. That’s a range of 2^96 addresses, should be enough for most uses.

## Summary

- Use `example.com` for your URLs in documentation
- Use safe top-level-domains
    - `.test`
    - `.example`
    - `.invalid`
    - `.localhost`
- Use safe IP -addresses in your documentation
    - `192.0.2.0/24`
    - `198.51.100.0/24`
    - `203.0.113.0/24`
    - `2008:bd8::/32`

Thanks to [Beko Pharm](https://social.tchncs.de/@bekopharm) for telling me about the `home.arpa` -domain!