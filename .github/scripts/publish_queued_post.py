#!/usr/bin/env python3
"""
Pops the next post off content/queued/manifest.json (in listed order),
moves it into blog/, stamps it with the real release date (Pacific time,
at the moment this actually runs), and updates blog.html, sitemap.xml,
and rss.xml to match.

If the queue is empty, this exits cleanly (published=false) and does not
fail the workflow or touch any files.
"""
import json
import os
import sys
import datetime

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None

QUEUE_DIR = "content/queued"
MANIFEST_PATH = os.path.join(QUEUE_DIR, "manifest.json")
BLOG_DIR = "blog"
SITEMAP_PATH = "sitemap.xml"
RSS_PATH = "rss.xml"
BLOG_LISTING_PATH = "blog.html"
SITE_URL = "https://sugarscannerapp.com"
QUEUE_INSERT_MARKER = "<!-- QUEUE_INSERT_POINT -->"
RSS_ANCHOR = '<atom:link href="https://sugarscannerapp.com/rss.xml" rel="self" type="application/rss+xml" />'


def gh_output(key, value):
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"{key}={value}\n")


def now_pacific():
    if ZoneInfo is not None:
        return datetime.datetime.now(ZoneInfo("America/Los_Angeles"))
    # Fallback (shouldn't happen on ubuntu-latest / Python 3.9+): use UTC.
    return datetime.datetime.utcnow()


def main():
    if not os.path.exists(MANIFEST_PATH):
        print(f"No manifest found at {MANIFEST_PATH} — nothing to publish. Skipping cleanly.")
        gh_output("published", "false")
        return

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    queue = manifest.get("queue", [])

    if not queue:
        print("Queue is empty — nothing to publish this week. Skipping cleanly.")
        gh_output("published", "false")
        return

    entry = queue.pop(0)
    slug = entry["slug"]
    title = entry.get("title", slug)
    category = entry.get("category", "Label Reading")
    excerpt = entry.get("excerpt", "")
    read_time = entry.get("readTime", "5 min")
    pin_image = entry.get("pinImage")

    src_path = os.path.join(QUEUE_DIR, slug)
    dest_path = os.path.join(BLOG_DIR, slug)

    if not os.path.exists(src_path):
        print(f"ERROR: manifest lists '{slug}' but {src_path} does not exist. "
              f"Skipping this run without publishing or touching the manifest, "
              f"so it can be fixed before the next scheduled run.")
        gh_output("published", "false")
        return

    pt = now_pacific()
    today = pt.date().isoformat()
    pub_date = pt.strftime("%a, %d %b %Y 08:00:00 GMT")  # matches existing rss.xml item format
    post_url = f"{SITE_URL}/blog/{slug}"

    # 1. Move the file into the live blog folder, stamping the real date in
    #    place of the {{PUBLISH_DATE}} placeholder (schema.org datePublished
    #    only -- there is no visible on-page date anywhere on this site).
    with open(src_path, "r", encoding="utf-8") as f:
        content = f.read()
    content = content.replace("{{PUBLISH_DATE}}", today)

    os.makedirs(BLOG_DIR, exist_ok=True)
    with open(dest_path, "w", encoding="utf-8") as f:
        f.write(content)
    os.remove(src_path)
    print(f"Moved {src_path} -> {dest_path}")

    # 2. Insert a new card into blog.html, right after the insert marker, so
    #    newly published posts appear first in "All Articles".
    with open(BLOG_LISTING_PATH, "r", encoding="utf-8") as f:
        listing = f.read()

    card = (
        f'\n    <a href="/blog/{slug}" class="post-card">\n'
        f'      <div class="post-category">{category}</div>\n'
        f'      <div class="post-title">{title}</div>\n'
        f'      <div class="post-excerpt">{excerpt}</div>\n'
        f'      <div class="post-meta">\n'
        f'        <span class="post-read">{read_time} →</span>\n'
        f'      </div>\n'
        f'    </a>\n'
    )

    if QUEUE_INSERT_MARKER in listing:
        listing = listing.replace(QUEUE_INSERT_MARKER, QUEUE_INSERT_MARKER + card, 1)
    else:
        print("WARNING: QUEUE_INSERT_POINT marker not found in blog.html — "
              "the post is live and in the sitemap/RSS, but a listing card "
              "was not added automatically. Add one manually.")
    with open(BLOG_LISTING_PATH, "w", encoding="utf-8") as f:
        f.write(listing)

    # 3. Add the new URL to sitemap.xml with today's real date as lastmod.
    with open(SITEMAP_PATH, "r", encoding="utf-8") as f:
        sitemap = f.read()

    url_entry = (
        f"<url>\n"
        f"<loc>{post_url}</loc>\n"
        f"<lastmod>{today}</lastmod>\n"
        f"<changefreq>monthly</changefreq>\n"
        f"<priority>0.7</priority>\n"
        f"</url>\n"
    )
    if "</urlset>" in sitemap:
        sitemap = sitemap.replace("</urlset>", url_entry + "</urlset>")
    else:
        print("WARNING: </urlset> not found in sitemap.xml — sitemap not updated.")
    with open(SITEMAP_PATH, "w", encoding="utf-8") as f:
        f.write(sitemap)

    # 4. Add the corresponding entry to rss.xml.
    with open(RSS_PATH, "r", encoding="utf-8") as f:
        rss = f.read()

    enclosure_block = ""
    if pin_image:
        enclosure_block = (
            f'<enclosure url="{SITE_URL}/{pin_image}" type="image/jpeg" length="0" />\n'
            f'<media:content url="{SITE_URL}/{pin_image}" medium="image" />\n'
        )
    item = (
        f"<item>\n"
        f"<title>{title}</title>\n"
        f"<link>{post_url}</link>\n"
        f"<guid>{post_url}</guid>\n"
        f"<description>{excerpt}</description>\n"
        f"<pubDate>{pub_date}</pubDate>\n"
        f"{enclosure_block}"
        f"</item>\n"
    )
    if RSS_ANCHOR in rss:
        rss = rss.replace(RSS_ANCHOR, RSS_ANCHOR + "\n\n" + item.rstrip("\n"), 1)
    elif "</channel>" in rss:
        rss = rss.replace("</channel>", item + "</channel>")
    else:
        print("WARNING: could not find an insertion point in rss.xml — rss not updated.")
    with open(RSS_PATH, "w", encoding="utf-8") as f:
        f.write(rss)

    # 5. Remove the published entry from the manifest so the queue advances.
    manifest["queue"] = queue
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    print(f"Published: {title} -> {post_url} (dated {today})")
    gh_output("published", "true")
    gh_output("title", title)


if __name__ == "__main__":
    main()
