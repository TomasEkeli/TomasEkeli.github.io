---
layout: post
title: Going serverless with Jekyll
date: 2023-09-04 21:38
category: meta
author: Tomas Ekeli
tags: [jekyll, wordpress, hosting, serverless, dns]
summary: This blog is now powered by Jekyll
---

I set up my own site on my own domain (eke.li) back in [January of this year (2023)]({% post_url 2023-01-16-hello-world %}) I have made some blogs years ago on different platforms, but this time I had my own domain and set up my own node in [Linode](https://www.linode.com/). I chose [WordPress](https://wordpress.com) as my platform - it's big, well-known, and I had used it before.

I've now decided that Wordpress is just a *lot* more functionality than I need. This site is just a place for me to write down my thoughts, and I don't need a full-blown CMS for that. I also don't want to have to worry about security updates, keeping the site updated, templates, add-ons and such. I want to focus on writing, not on maintaining another site.

I believe most of the web could be very well-served by just static files (html, css and javascript can do amazing things). And, this is coming from me as a backend-developer! When you need state to change you need a server, but that's not a need me here.

I have decided to just write these posts and put them out as static files on a server. I already had my [Linode Nano](https://www.linode.com/community/questions/211/what-is-a-nanode) -node that served my instance, and could have re-used that. But, for my needs even having a server is far too much power. I don't need to run a server 24/7, and I don't need to pay for it. I just need to be able to serve some static files on URLs.

I quite like writing HTML directly, but [MarkDown](https://daringfireball.net/projects/markdown/) is easier to write. And, repeating headers and footers in every file by hand gets tiresome. This tells me I need a tool to create the static html/css/js from my markdown -files. And by doing it at compile-time the server can just serve the static files.

I have also been paying for monthly backups of my Linode -node, just in case; but I'd much rather just have my text in a git repository. By using a simple text-format instead of entering the text into a CMS and having that store it in a database I can write my posts in any editor I want, and I can use git to track changes. This future-safes my site as all my "content" is available in git, and in this case on GitHub.

All this lead me to set up a [Jekyll](https://github.com/jekyll/jekyll) -powered site, running on [GitHub pages](https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/about-github-pages-and-jekyll). I moved all my posts from WordPress over into markdown, and set up [automatic deployment](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) of my new github-repository. This way I can use git to publish my posts, and I don't have to worry about servers at all!

It was a little fiddly [setting up DNS correctly](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) to direct requests to my domain to where this site is hosted. I had to set up a CNAME -record (essentially a redirect) pointing to the github-pages hostname I was assigned, and since I want requests to the "naked" domain to be redirected to this www -subdomain I also had to set up A and AAAA records pointing to githubs servers. I could have set up a server on the "naked" -domain to do the re-direct, but this way I don't have to worry about even that.

The one thing I am lacking now, that I had, is some analytics. I am not a fan of all the tracking that goes on on the web, but I did get some personal satisfaction looking that someone were reading my posts (I never had anything beyond a simple count of served pages). This is a pittance, though - I will not add any tracking to this site, dear reader. I will just have to be satisfied with the knowledge that I am writing for myself, and that I am publishing my thoughts for anyone to read.

So, this is my first post on my new blog. I hope you enjoy it, and I hope you will come back for more. All old links should keep working ([as is good and proper](https://www.w3.org/Provider/Style/URI)).

If you have any comments please reach out to me on any of the socials in the footer of this page. I'd love to hear from you.

