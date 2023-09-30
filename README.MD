# Thoughs and stuff

The [Thoughts and stuff](https://www.eke.li) -blog, running as [Jekyll](https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/creating-a-github-pages-site-with-jekyll) with automatic deployment from GitHub to GitHub Pages.

## Localdev

To run locally it is recommended to use the devcontainer that is part of this repository.

Open a terminal window in the docs -directory and start Jekyll with

```bash
$ bundle install
$ bundle exec jekyll serve
```

The site will be available on port http://localhost:4000

## Deployment

Pushing to the `main` -branch will deploy the Jekyll -site under `docs`

## Paths to posts

The "old" -blog was a WordPress -site, and the URLs to posts were in the format: `/yyyy/dd/title/` - probably best to retain that standard.