# Queued blog posts

This folder is the "write now, publish later" holding area for finished blog
posts that haven't gone live yet. Nothing in here is linked from anywhere on
the live site, and `/content/queued/` is blocked in `robots.txt` — but since
this is a static GitHub Pages site, a file placed here is still technically
fetchable at its raw URL if someone guessed it. Treat this folder as
"not indexed, not linked, not announced" rather than truly private.

## How the pipeline works

Every Wednesday at 8:00 AM Pacific, the `.github/workflows/publish-queued-post.yml`
GitHub Action runs automatically:

1. Reads `manifest.json` and takes the **first** entry in the `queue` array.
2. Moves that post's HTML file from `content/queued/` into `blog/`.
3. Replaces the `{{PUBLISH_DATE}}` placeholder in the file's schema.org
   `datePublished` field with the real date the action runs (nothing is
   pre-dated — the file has no real date in it until the moment it's
   actually released).
4. Adds a card for it to `blog.html` (top of "All Articles").
5. Adds its URL to `sitemap.xml` with today's date as `lastmod`.
6. Adds a matching `<item>` to `rss.xml`.
7. Removes that entry from `manifest.json` and commits + pushes everything
   to `main`, which Netlify auto-deploys.

If the queue is empty, the action logs that and stops — it does not fail
and does not publish anything broken.

You can also trigger a publish manually any time from the Actions tab
("Publish Queued Blog Post" → "Run workflow") — this skips the day/time
check entirely, which is useful for testing or an out-of-cycle release.

## Adding a post to the queue

1. Write the post as a normal `.html` file using the same template as the
   posts already in `blog/` (nav, article-hero, article-body, related,
   newsletter-strip, footer). Copy an existing post as your starting point.
2. In the file's `<script type="application/ld+json">` block, set
   `"datePublished": "{{PUBLISH_DATE}}"` — literally that placeholder
   string. The pipeline fills in the real date when it actually publishes.
   Don't add a visible date anywhere on the page itself; this site doesn't
   show publish dates to readers.
3. Save the file into `content/queued/`, e.g. `content/queued/my-new-post.html`.
4. Add an entry for it to the **end** of the `queue` array in `manifest.json`:

```json
{
  "slug": "my-new-post.html",
  "title": "Exact H1 / <title> text",
  "category": "Ingredient Deep Dive",
  "excerpt": "One or two sentences — this becomes the blog.html card excerpt AND the rss.xml description.",
  "readTime": "6 min",
  "pinImage": "pins/pin-my-new-post.jpg"
}
```

   - `category` — matches whatever you used in the post's own
     `.article-category` / breadcrumb. Existing categories on the site:
     "Ingredient Deep Dive", "Liver Health", "Label Reading". Free text —
     use a new one if it fits better.
   - `pinImage` — path to the Pinterest pin image if one exists yet
     (relative to site root, e.g. `pins/pin-my-new-post.jpg`). Set to
     `null` if there isn't one yet; the rss `<enclosure>`/`<media:content>`
     tags are simply omitted for that item until you add a real image and
     update the manifest before it publishes.
   - Order in the array = release order. The action always publishes
     whichever entry is **first**.

5. Commit `content/queued/my-new-post.html` and the updated `manifest.json`
   to `main` (or a branch + PR, if you'd rather review before it's queued —
   either way, the file sits harmlessly in `content/queued/` until its turn
   comes up in the schedule).

That's it — no manual publish step, no editing `blog.html` / `sitemap.xml` /
`rss.xml` by hand for queued posts.
