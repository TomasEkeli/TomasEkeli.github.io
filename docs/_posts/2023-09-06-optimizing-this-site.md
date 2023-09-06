---
layout: post
title: Optimizing this site
date: 2023-09-06 09:30
category: meta
author: Tomas Ekeli
tags: [web, dev]
excerpt: I've put some effort into optimizing this site
main-image: /assets/img/2023-09-06-optimizing-this-site.webp
main-image-alt: Make it go fast
---

![{{ page.main-image-alt }}]({{ page.main-image }})

My previous post was about moving this site from a server running WordPress, and that has been a success.

However, as I tested my site I noticed that it was performing far worse than I expected. Moving to static files instead of Wordpress made all the requests quicker, by a lot, but there were still a lot of easy things I could do.

## Why optimize?

I have been developing for the web for over 20 years now, and remember the days when the size of things we sent over the wire mattered more than it seems today. It's easy to forget, but many people are still using low-bandwidth connections, or intermittent ones.

People might also be on metered connections, paying the cost of unnecessarily large downloads in a very real way.

There's also research that tells us that how quickly a system seems to react and present information [affects the people who use it](https://www.nngroup.com/articles/response-times-3-important-limits/) in a very real way. There are diminishing returns, but accepting that anything on a simple site like this takes over a second to get to seems silly.

## What to optimize?

I'm a backend developer, and would usually go about optimizing a site by looking at (or maybe adding) instrumentation to figure out what is taking a long time. Normal culprits are databases and third-party services (anything that goes over a network connection), and then file-system -access.

Next I would have made sure the site was set up correctly to serve compressed streams, when possible. This is not something I control with my current setup, but it seems to be correctly configured by GitHub.

However, this is a site that just serves static files (which is excellent). If I were hosting it myself with full control of everything I would make sure caching was done as well as possible to take full advantage of the distributed cache that is the network.

Since I am a bit removed, using Github Pages to host, the thing I can really optimize is the size of the resources that the browser downloads. And there were some optimizations to have here!

## Media

> A picture is worth a thousand words, but the words download quicker
>
> -- old internet saying

I use pictures on most of my posts, and I wanted to have a main-picture on the listing of posts (the "front-page"). A few experiments with that showed me that the page quickly ballooned in size to many megabytes!

This lead me to look at my assets-folder, and there I found images in several formats and ranging from a few kilobytes to one that was over 6 megabytes! This is 12 megabytes of images that I was proposing people download, for me that was too much.

### Before
```bash
total 12M
1.3M 2023-01-17-podcasts.png
8.0K 2023-01-29-a-nice-palette.png
 68K 2023-01-29-bookwyrm.png
268K 2023-02-23-domains-in-docs.webp
452K 2023-02-24-winter-is-back.jpg
 80K 2023-03-12-devcontainers-00.png
8.0K 2023-03-12-devcontainers-01-add-devcontainer.png
 60K 2023-03-12-devcontainers-02-select-configuration.png
232K 2023-03-16-vscode-tasks.webp
180K 2023-03-17-ai-chicken.jpg
324K 2023-04-02-oneof-with-benchmarks.png
532K 2023-05-09-generating-domin-driven-code.png
6.5M 2023-05-23-merging-aggregates.png
260K 2023-05-25-reconnecting.jpg
1.3M 2023-09-04-going-serverless-with-jekyll.png
```

I started by cropping some of the pictures a bit, less pixels means less bytes, right? That helped a tiny bit, but was a lot of manual work for very little improvement.

So I decided to convert these images to a more efficient format. PNG is non-lossy, and great for some uses, but for me it's not necessary. JPG is a great format, but these days we can use Webp, which is usually even better for web.

To convert all the images I used a debian package called [ImageMagick](https://github.com/ImageMagick/ImageMagick), specifically the `mogrify` command-line tool. The following will install the package on a Linux machine with apt, and use it to convert all files with `jpg`, `jpeg` or `png` -extensions to `webp`, deleting the originals. Thanks to [this question on AskUbuntu](https://askubuntu.com/questions/1398977/how-to-convert-all-images-from-subdirectories-to-webp) for this!

```bash
$ sudo apt update
$ sudo apt install imagemagick
$ find . -type f -regex ".*\.\(jpg\|jpeg\|png\)" -exec mogrify -format webp {}  \; -print
$ find . -type f -regex ".*\.\(jpg\|jpeg\|png\)" -exec rm {}  \; -print
```

This made all my images in total go from 12 megabytes to under 750 kilobytes!

### After
```bash
total 736K
 28K 2023-01-17-podcasts.webp
8.0K 2023-01-29-a-nice-palette.webp
 20K 2023-01-29-bookwyrm.webp
 68K 2023-02-23-domains-in-docs.webp
 84K 2023-02-24-winter-is-back.webp
 44K 2023-03-12-devcontainers-00.webp
8.0K 2023-03-12-devcontainers-01-add-devcontainer.webp
 36K 2023-03-12-devcontainers-02-select-configuration.webp
100K 2023-03-16-vscode-tasks.webp
 60K 2023-03-17-ai-chicken.webp
 20K 2023-04-02-oneof-with-benchmarks.webp
 20K 2023-05-09-generating-domin-driven-code.webp
 92K 2023-05-23-merging-aggregates.webp
 52K 2023-05-25-reconnecting.webp
 88K 2023-09-04-going-serverless-with-jekyll.webp
```

With this I was confident I could now have a post-listing on the front-page with most of the images and still download quickly.

## Remote requests

As I was looking further at my posts I noticed that the [podcasts]({% post_url 2023-01-17-podcasts %}) -post was still really slow and downloaded over 35 megabytes of data!

I have to admit that when I made that post back in January I made a hasty import of an exported site from my podcast-app on my phone, [AntennaPod](https://antennapod.org/). It simply gave a list with the URLs of the feeds and their cover-images.

This made for an ugly list, but more importantly for optimization it made the browser go out and fetch a lot of images from third-parties and usually at large sizes.

To fix this I downloaded all the images myself, resized them to a smaller size (200x200 pixels) and performed the same mass-conversion on them.

This made me serve more files from the local site (which is usually good for speed, and very good for not tracking and security), and reduced the total weight of the podcasts -post to under 500 kilobytes!

## Conclusion

By making sure images this site serves are as small as possible I was able to give the front-page a post-listing with images and reduced the weight of the site by quite a lot. This makes the site feel a lot faster and easier to navigate, and it lets me use images with less trepidation.

I hope you like it!