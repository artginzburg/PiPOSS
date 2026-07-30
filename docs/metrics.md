# Metrics — how to find out whether anyone is installing PiPOSS

There is **no telemetry in the app, no scheduled job and no committed CSV**
(DECISIONS.md § Phase 1 item 4, RRR §11). Everything below is pulled on demand from
public endpoints, in about a minute, and compared against the baseline in §7.

Every command in this file was run on **2026-07-27** and the output shown is the real
output of that run. Every command is self-contained. One deliberate exception to
verbatim output: `averageUserRating` is a float and `jq-1.7.1-apple` prints it at full
binary precision — `4.42283999999999988261834005243144929409027099609375` where this
file writes `4.42284`. Ratings are truncated to six significant figures; every other
figure is byte-for-byte as printed.

**Read §5 before you read any App Store number, including one you find in RRR.md.**
Competitor volume on the Mac App Store is not observable from here as of 2026-07-27 —
Apple's feeds report zero ratings for every Mac app, which is a regression rather than
policy, so §5 gives a one-command canary for checking whether it has come back.

Requirements: `curl`, `jq`, and `gh` authenticated as the repository owner (the Homebrew
and iTunes endpoints need no auth; the GitHub API needs it only for a higher rate limit
and for the traffic endpoints in §4).

---

## 1. The whole reading in one command

Save as `/tmp/pull.sh`, `chmod +x`, run. Read-only; no arguments; no inputs.

```sh
#!/bin/sh
# PiPOSS on-demand metrics. No arguments. Read-only. Self-contained. ~10 s.
set -u
echo "### reading taken: $(date -u '+%Y-%m-%d %H:%MZ')"

echo
echo "### Homebrew cask installs, all of artginzburg/tap  (trailing windows = already a rate)"
for p in 30d 90d 365d; do
  curl -fsS "https://formulae.brew.sh/api/analytics/cask-install/$p.json" \
  | jq -r --arg p "$p" '
      "-- \($p)  window \(.start_date) .. \(.end_date)  (\(.total_items) casks listed)",
      (.items[] | select(.cask|startswith("artginzburg/tap/"))
       | "   \(.cask)\t\(.count)")' \
  || echo "-- $p  FETCH FAILED"
done

echo
echo "### GitHub release asset downloads (CUMULATIVE lifetime totals, never reset)"
gh api repos/artginzburg/PiPOSS/releases --paginate \
  --jq '.[] | .tag_name as $t | .published_at[0:10] as $d
        | .assets[] | "   \($t)\t\($d)\t\(.name)\t\(.download_count)"'
printf '   TOTAL\t'
gh api repos/artginzburg/PiPOSS/releases --paginate --jq '[.[].assets[].download_count] | add'

echo
echo "### Repository"
gh api repos/artginzburg/PiPOSS --jq '"   stars \(.stargazers_count)  forks \(.forks_count)"'
```

Actual output, 2026-07-27:

```
### reading taken: 2026-07-27 02:38Z

### Homebrew cask installs, all of artginzburg/tap  (trailing windows = already a rate)
-- 30d  window 2026-06-27 .. 2026-07-27  (11514 casks listed)
   artginzburg/tap/wheelclick	6
   artginzburg/tap/darkmode	1
   artginzburg/tap/piposs	1
-- 90d  window 2026-04-28 .. 2026-07-27  (15603 casks listed)
   artginzburg/tap/wheelclick	6
   artginzburg/tap/2fatotray	1
   artginzburg/tap/piposs	1
   artginzburg/tap/functiontoggler	1
   artginzburg/tap/darkmode	1
-- 365d  window 2025-07-27 .. 2026-07-27  (20845 casks listed)
   artginzburg/tap/wheelclick	6
   artginzburg/tap/piposs	5
   artginzburg/tap/2fatotray	3
   artginzburg/tap/functiontoggler	2
   artginzburg/tap/darkmode	1

### GitHub release asset downloads (CUMULATIVE lifetime totals, never reset)
   1.0.3	2025-10-13	PiPOSS.zip	22
   1.0.2	2025-10-04	PiPOSS.zip	33
   1.0.1	2022-08-29	PiPOSS.zip	63
   1.0	2022-08-27	PiPOSS.zip	9
   TOTAL	127

### Repository
   stars 4  forks 0
```

---

## 2. Homebrew cask analytics

**Third-party taps are included in Homebrew's published analytics.** This is not obvious
and it is the most useful fact in this file — `artginzburg/tap/*` appears in the same JSON
as `firefox`, keyed by the fully-qualified cask name.

Three endpoints, one per window:

```
https://formulae.brew.sh/api/analytics/cask-install/30d.json
https://formulae.brew.sh/api/analytics/cask-install/90d.json
https://formulae.brew.sh/api/analytics/cask-install/365d.json
```

They are large (815 KB / 1.1 MB / 1.5 MB, 11 514 / 15 603 / 20 845 items on 2026-07-27)
so do not eyeball them, and do not save them to disk just to grep them. Pipe straight
through `jq`, filtering on the tap prefix — the owner has several casks and reading all of
them in one pass is strictly more useful than hardcoding `piposs`:

```sh
for p in 30d 90d 365d; do
  curl -fsS "https://formulae.brew.sh/api/analytics/cask-install/$p.json" \
  | jq -r --arg p "$p" '"=== \($p)  \(.start_date) .. \(.end_date)  (\(.total_items) casks)",
      (.items[]|select(.cask|startswith("artginzburg/tap/"))|"   \(.cask)\t\(.count)")'
done
```

Output is §1's Homebrew block.

Scale of the whole file, and our place in it:

```sh
curl -fsS "https://formulae.brew.sh/api/analytics/cask-install/365d.json" \
| jq -r '{total_items, start_date, end_date, total_count},
         (.total_items as $n | .items[] | select(.cask=="artginzburg/tap/piposs")
          | "rank \(.number) of \($n)  count \(.count)  percent \(.percent)"),
         (.items[0] | "top cask: \(.cask)\t\(.count)")'
```

```
{
  "total_items": 20845,
  "start_date": "2025-07-27",
  "end_date": "2026-07-27",
  "total_count": 24520875
}
rank 11554 of 20845  count 5  percent 0
top cask: claude-code	1,056,932
```

### Traps

- **`count` and `percent` are comma-formatted strings, not numbers:**

  ```sh
  curl -fsS "https://formulae.brew.sh/api/analytics/cask-install/30d.json" \
  | jq -r '.items[0] | {count, count_type:(.count|type), percent, percent_type:(.percent|type)}'
  ```

  ```
  {
    "count": "86,018",
    "count_type": "string",
    "percent": "3.83",
    "percent_type": "string"
  }
  ```

  Arithmetic on `count` needs `(.count|gsub(",";"")|tonumber)`; `.percent` needs
  `tonumber`. At our volume neither bites; on a comparison cask both will.
- **`number` (rank) is not stable between reads.** Two pulls minutes apart on 2026-07-27
  put `piposs` at 30 d rank `#9014` and then `#10349` with an identical count of 1 —
  everything on 1 install is a tie broken arbitrarily. Track `count`, never rank.
- **The counts drift within a day.** The top cask read `86,004` and then `86,018` an hour
  later; `total_items` went 11 511 → 11 514. Record the timestamp with the reading.

### Two false negatives that both look like "zero installs"

Neither produces an error that says "wrong approach".

**1. `brew info --analytics` silently prints nothing for a third-party cask** — zero
bytes, exit 0:

```sh
brew info --analytics --cask artginzburg/tap/piposs > /tmp/brewinfo.log 2>&1
echo "EXIT=$? bytes=$(wc -c </tmp/brewinfo.log)"
```

```
EXIT=0 bytes=       0
```

The flag itself works — it is the third-party namespace the CLI does not query:

```sh
brew info --analytics --cask firefox
```

```
==> Analytics
==> install (30 days)
Index | Name (with options)                                  |  Count |  Percent
-----:|------------------------------------------------------|-------:|--------:
1     | firefox                                              | 14,100 |  100.00%
==> install (90 days)
Index | Name (with options)                                  |  Count |  Percent
-----:|------------------------------------------------------|-------:|--------:
1     | firefox                                              | 48,167 |  100.00%
==> install (365 days)
Index | Name (with options)                                 |   Count |  Percent
-----:|-----------------------------------------------------|--------:|--------:
1     | firefox                                             | 201,021 |  100.00%
```

The cask name is not the problem either — plain `brew info` resolves it:

```sh
brew info --cask artginzburg/tap/piposs
```

```
==> piposs (PiPOSS): 1.0.3
Brings Picture in Picture shortcut and custom button to any video
https://github.com/artginzburg/PiPOSS
Installed (on request)
/opt/homebrew/Caskroom/piposs/1.0.3 (1.3MB)
  Installed on 2026-07-26 at 22:49:02
From: https://github.com/artginzburg/homebrew-tap/blob/HEAD/Casks/piposs.rb
```

**2. The per-cask JSON endpoint 404s with an HTML body**, so `curl … | jq` dies on the
HTML instead of returning a zero. This is the URL a future agent will try first, because
it is the obvious one:

```sh
curl -s "https://formulae.brew.sh/api/cask/piposs.json" | head -c 120
curl -s "https://formulae.brew.sh/api/cask/piposs.json" | jq -r '.installs."30d".cask'; echo "EXIT=$?"
curl -fsS "https://formulae.brew.sh/api/cask/piposs.json" > /dev/null; echo "EXIT=$?"
```

```
<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="Content-type" content="text/html; charset=utf-8">
    <meta http-e
jq: parse error: Invalid numeric literal at line 1, column 10
EXIT=5
curl: (56) The requested URL returned error: 404
EXIT=56
```

The control proves it is third-party-specific, not a dead endpoint:
`curl -o /dev/null -w '%{http_code}' https://formulae.brew.sh/api/cask/firefox.json` →
`200`. **Always use `curl -f`** so a 404 fails loudly instead of arriving as a `jq` parse
error you might read as absence of data.

### Direction of error — see §8's table; two items need their evidence here

- **Self-installs are counted.** Analytics are on this machine (`brew analytics` →
  `InfluxDB analytics are enabled.`) and `brew info` above reports
  `Installed on 2026-07-26 at 22:49:02`. The 30 d and 90 d counts are both exactly 1, so
  the single install in the last 90 days *is* the same event as the single install in the
  last 30 — and it lands on the date the owner installed it himself. The honest reading of
  "1 install in 30 days" is **zero to one genuine third-party install**.
- These windows are **trailing and self-updating** (they always end today), so they are
  already a rate. That is the opposite of §3, and it is why Homebrew is the better of the
  two signals despite the smaller number.

---

## 3. GitHub release download counts

```sh
gh api repos/artginzburg/PiPOSS/releases --paginate \
  --jq '.[] | .tag_name as $t | .published_at[0:10] as $d
        | .assets[] | "\($t)\t\($d)\t\(.name)\t\(.download_count)"'
gh api repos/artginzburg/PiPOSS/releases --paginate --jq '[.[].assets[].download_count] | add'
```

Output is §1's GitHub block: 1.0.3 → 22, 1.0.2 → 33, 1.0.1 → 63, 1.0 → 9, total **127**.

```sh
gh api repos/artginzburg/PiPOSS --jq '{stars:.stargazers_count, forks:.forks_count, created:.created_at, license:.license.spdx_id}'
```

```
{"created":"2022-08-27T15:48:40Z","forks":0,"license":"MIT","stars":4}
```

### Write the `jq` this way, not the obvious way

The natural one-liner is wrong. `"\(.assets[].name)\t\(.assets[].download_count)"` iterates
`.assets[]` **twice inside one string**, producing a cartesian product. At one asset per
release it is accidentally correct, which is why it survives review; on a multi-asset
release it silently multiplies. Demonstrated on a repository with many assets per release:

```sh
gh api repos/cli/cli/releases/tags/v2.96.0 --jq '.assets|length'
gh api repos/cli/cli/releases/tags/v2.96.0 --jq '"\(.tag_name)\t\(.assets[].name)\t\(.assets[].download_count)"' | wc -l
gh api repos/cli/cli/releases/tags/v2.96.0 --jq '.assets[] | "\(.name)\t\(.download_count)"' | wc -l
```

```
22
484
22
```

22 assets, **484 lines** — 22², with mismatched name/count pairs throughout, and no error.
Bind the release fields to variables first (`.tag_name as $t`), then iterate `.assets[]`
exactly once, as the commands above do. PiPOSS ships one asset per release today, so the bug
is invisible here — it will appear the first time a release carries a `.dmg` beside the
`.zip`, or a checksum file.

Also: **`gh api …/releases` is paginated at 30 by default.** Harmless at four releases,
silently truncating past thirty. Verified — `gh api repos/cli/cli/releases --jq 'length'` →
`30`, while `--paginate` yields pages of `100`, `99`, …. Always pass `--paginate`.

### These counters are cumulative and never reset

`download_count` is a lifetime total per asset since that release was published. It only
goes up; GitHub offers no per-day breakdown and no way to reset it. **So a single reading is
a total, not a rate** — 127 downloads means "127 downloads across 35 months", and the only
way to get a rate is to **subtract two readings taken at different times**, which is why §7
records a dated baseline.

Note also: 1.0.1 (63) has more lifetime downloads than 1.0.3 (22) simply because it was
downloadable for 38 months rather than 9. Do not read that as decline. For anything current,
watch the newest tag only.

Bots, mirrors and CI count as downloads. Bias: **upward**.

---

## 4. GitHub traffic (14-day rolling) — a distant third

Requires push access. Unlike §3 these *do* reset — a 14-day rolling window — which makes
them the only GitHub number that is natively a rate.

```sh
gh api repos/artginzburg/PiPOSS/traffic/views  --jq '{count,uniques,days:(.views|length)}'
gh api repos/artginzburg/PiPOSS/traffic/clones --jq '{count,uniques}'
gh api repos/artginzburg/PiPOSS/traffic/popular/referrers | jq -r '.[] | [.referrer,.count,.uniques] | @tsv'
gh api repos/artginzburg/PiPOSS/traffic/clones --jq '.clones[] | "\(.timestamp[0:10])\t\(.count)\t\(.uniques)"'
```

```
{"count":0,"uniques":0,"days":14}
{"count":7,"uniques":5}
(referrers: empty list)
2026-07-12	0	0
2026-07-13	0	0
2026-07-14	0	0
2026-07-15	1	1
2026-07-16	0	0
2026-07-17	0	0
2026-07-18	0	0
2026-07-19	0	0
2026-07-20	0	0
2026-07-21	0	0
2026-07-22	0	0
2026-07-23	1	1
2026-07-24	1	1
2026-07-25	4	2
```

All fourteen rows are shown, ten of them zero — the endpoint zero-fills the window rather
than omitting empty days, so a 14-row response is not evidence of 14 days of activity.

Zero page views alongside five distinct cloners is internally inconsistent enough that this
endpoint is not a demand signal at this volume; clones at this scale are mostly automated.
The empty referrer list, consistent with "nothing is linking here", is the real finding. Use
these only to detect a **step change** after a launch post: a referrer suddenly appearing
with a non-trivial count is meaningful, a change from 7 clones to 11 is not.

---

## 5. Mac App Store competitor ratings are **not reported as of 2026-07-27**

The project has got this wrong twice — once from a third-party estimator, and once from
these very endpoints. RRR §1 has been corrected accordingly.

**This is a regression in Apple's feeds, not a property of the platform.** The field
demonstrably used to work; see "Not permanent" below, which also gives the one-command
canary for checking whether it has come back.

### The artifact: `kind: mac-software` reports zero ratings for everything

Apple's public iTunes feeds return `userRatingCount: 0` for **every** record of
`kind: mac-software`. Controls — four Mac apps that unquestionably have thousands of
ratings on their store pages:

```sh
for id in 937984704 904280696 441258766 1176895641; do
  curl -s "https://itunes.apple.com/lookup?id=${id}&country=us" \
  | jq -r '.results[0] | [(.trackName//"?"),(.kind//"?"),(.userRatingCount//0),(.averageUserRating//0)] | @tsv'
  sleep 2
done
```

```
Amphetamine	mac-software	0	0
Things 3	mac-software	0	0
Magnet	mac-software	0	0
Spark Classic – Email App	mac-software	0	0
```

**So every zero in a table of Mac ratings is an API artifact, not a finding.** There is no
way to distinguish "no ratings" from "not reported" on the Mac side.

The cleanest proof is one app with both listings. PiPifier ships a Mac version and an iOS
version under the same developer; only the iOS record reports:

```sh
curl -s "https://itunes.apple.com/lookup?id=1160374471&country=us" \
| jq -r '.results[0]|[.trackName,.kind,.bundleId,(.userRatingCount//0),(.averageUserRating//0)]|@tsv'
sleep 2
curl -s "https://itunes.apple.com/search?term=pipifier&entity=software&country=us&limit=10" \
| jq -r '.results[0]|[.trackName,.kind,.bundleId,(.userRatingCount//0),(.averageUserRating//0)]|@tsv'
```

```
PiPifier	mac-software	de.APPenzeller.PiPifier	0	0
PiPifier	software	de.APPenzeller.PiPifier-iOS	324	4.42284
```

Same app, same developer: `0` on the Mac record, **324 ratings at 4.42** on the iOS
record. The zero is the artifact.

### Not permanent — the field used to work, and here is the canary

The Mac store page carries a JSON-LD `aggregateRating` block, and archived copies of it
show real, sensibly growing numbers until at least late 2024. Fetch any snapshot through
`web.archive.org/web/<timestamp>id_/` and grep it:

```sh
for ts in 20200606212150 20230609224151 20240304173930 20241107020951; do
  printf '%s  ' "$ts"
  curl -sL --max-time 45 "https://web.archive.org/web/${ts}id_/https://apps.apple.com/us/app/amphetamine/id937984704" \
  | grep -o '"aggregateRating":{[^}]*}' | head -1
  echo; sleep 3
done
```

```
20200606212150  "aggregateRating":{"@type":"AggregateRating","ratingValue":4,"reviewCount":2}
20230609224151  "aggregateRating":{"@type":"AggregateRating","ratingValue":4.8,"reviewCount":2182}
20240304173930  "aggregateRating":{"@type":"AggregateRating","ratingValue":4.8,"reviewCount":2430}
20241107020951  "aggregateRating":{"@type":"AggregateRating","ratingValue":4.8,"reviewCount":2572}
```

2 → 2182 → 2430 → 2572 over four years, on a Mac-only app. **So Mac-side rating counts
were published and behaved sensibly through 2024-11, and read zero now.** That makes the
zero a change in Apple's feeds, not an immutable property, and it means §7's instruction
to re-check is a real instruction rather than a formality.

**The canary** — a Mac app with thousands of ratings, one command:

```sh
curl -sL https://apps.apple.com/us/app/amphetamine/id937984704 | grep -o '"aggregateRating"[^}]*}'
```

```
"aggregateRating":{"@type":"AggregateRating","ratingValue":0,"reviewCount":0,"bestRating":"5","worstRating":"1"}
```

**Nonzero means Mac-side numbers are readable again** and this section's rule can be
revisited — at which point re-run the niche table below, because the nineteen zeros would
become real data. Zero means nothing has changed.

**The `-L` is load-bearing.** Without it the page 301-redirects and the grep finds
nothing, which looks identical to "the field is gone" — a false negative of exactly the
kind this section is about:

```sh
curl -s https://apps.apple.com/us/app/amphetamine/id937984704 | grep -o '"aggregateRating"[^}]*}'; echo "EXIT=$?"
curl -s -o /dev/null -w 'http=%{http_code} redirect=%{redirect_url}\n' https://apps.apple.com/us/app/amphetamine/id937984704
```

```
EXIT=1
http=301 redirect=https://apps.apple.com/us/app/amphetamine/id937984704?mt=12
```

**How precisely the transition is dated: it is not.** Last working snapshot 2024-11-07;
live page reads zero on 2026-07-27; **the honest window is 2024-11 to 2026-07.** Snapshots
in between cannot narrow it — every 2025 capture sampled (2025-01-25, 2025-06-07,
2025-10-11, 2025-10-30) contains **no JSON-LD block at all**, absent rather than zero,
because Wayback stored a JavaScript shell of about 89 KB. No 2026 snapshot is indexed:
`https://archive.org/wayback/available?url=…&timestamp=20260315` returns `20251030032851`
as the nearest, and the CDX API returned `503 Service Unavailable` on two attempts.
**Absence of the field in a snapshot is not evidence of a zero** — only the four fetches
above and the live read are evidence.

### Consequence: OverPicture's ratings are its **iOS** ratings

```sh
curl -s "https://itunes.apple.com/lookup?id=1188020834&country=us" \
| jq -r '.results[0] | {trackName,kind,bundleId,features,
    supportedDevices:((.supportedDevices//[])|length),
    price:.formattedPrice,userRatingCount,averageUserRating,
    released:.releaseDate[0:10],updated:.currentVersionReleaseDate[0:10],version}'
```

```
{
  "trackName": "OverPicture for Safari",
  "kind": "software",
  "bundleId": "com.pvieito.OverPicture",
  "features": [
    "iosUniversal"
  ],
  "supportedDevices": 128,
  "price": "$3.99",
  "userRatingCount": 12,
  "averageUserRating": 4.25,
  "released": "2016-12-30",
  "updated": "2026-02-06",
  "version": "2.7.1"
}
```

`kind: software`, `features: ["iosUniversal"]`, 128 supported devices. The 12 US ratings are
the **iOS** side of a universal app. **OverPicture's Mac-side rating count and its Mac sales
are not readable from here at all.** An earlier draft of this file, and the first correction
to RRR §1, both presented that 12 as evidence about the Mac market; it is not.

### Ratings are also per storefront

Even on the readable iOS side, `country=us` is one slice. Nine markets:

```sh
for cc in us gb de fr jp cn ru br in; do
  printf '%s\t' "$cc"
  curl -s "https://itunes.apple.com/lookup?id=1188020834&country=${cc}" \
  | jq -r '.results[0] | "\(.formattedPrice)\t\(.userRatingCount // 0)\t\(.averageUserRating // 0)"'
  sleep 2
done
```

```
us	$3.99	12	4.25
gb	£3.99	3	5
de	3,99 €	4	3.75
fr	3,99 €	1	4
jp	¥600	4	4.25
cn	¥28.00	7	4.42856
ru	349,00 ₽	1	2
br	R$ 24,90	1	4
in	₹ 399	0	0
```

Rather than leave a lower bound for someone else to redo, the full sweep — every App Store
storefront, 2 s apart, ~5.5 min:

```sh
#!/bin/sh
# Sum OverPicture's iOS ratings across every App Store storefront.
set -u
ID=1188020834
CCS="ae ag ai al am ao ar at au az bb be bf bg bh bj bm bn bo br bs bt bw by bz ca cg ch ci cl cn co cr cv cy cz de dk dm do dz ec ee eg es fi fj fm fr ga gb gd ge gh gm gr gt gw gy hk hn hr hu id ie il in is it jm jo jp ke kg kh kn kr kw ky kz la lb lc lk lr lt lu lv md mg mk ml mm mn mo mr ms mt mu mv mw mx my mz na ne ng ni nl no np nz om pa pe pg ph pk pl pt pw py qa ro ru rw sa sb sc se sg si sk sl sn sr st sv sz tc td th tj tm tn tr tt tw tz ua ug us uy uz vc ve vg vn ye za zm zw"
: > /tmp/sweep.tsv
for cc in $CCS; do
  n=$(curl -s --max-time 15 "https://itunes.apple.com/lookup?id=${ID}&country=${cc}" \
      | jq -r 'if (.resultCount // 0) > 0 then (.results[0].userRatingCount // 0) else "MISS" end' 2>/dev/null)
  [ -z "$n" ] && n=MISS
  printf '%s\t%s\n' "$cc" "$n" >> /tmp/sweep.tsv
  sleep 2
done
echo "storefronts_queried=$(wc -l < /tmp/sweep.tsv | tr -d ' ')"
echo "misses=$(grep -c 'MISS' /tmp/sweep.tsv || true)"
echo "ratings_total=$(grep -v 'MISS' /tmp/sweep.tsv | awk -F'\t' '{s+=$2} END {print s+0}')"
echo "--- nonzero ---"
grep -v 'MISS' /tmp/sweep.tsv | awk -F'\t' '$2>0 {print $1"="$2}' | tr '\n' ' '; echo
```

```
storefronts_queried=162
misses=0
ratings_total=56
--- nonzero ---
at=1 be=1 br=1 ch=1 cn=7 co=2 de=4 es=4 fr=1 gb=3 il=1 it=1 jp=4 kr=1 lv=1 mx=2 nl=4 ph=1 pt=1 ro=1 ru=1 th=1 us=12
```

**56 iOS ratings across 162 storefronts, zero fetch failures**, spread over 23 markets;
the US figure of 12 is 21% of the total. This is a complete reading, not a lower bound —
but of the **iOS** side only, and it says nothing about Mac. Note also that
`averageUserRating` is per storefront, so those averages cannot be averaged; they must be
weighted by count.

### What *is* observable: price, existence, and `kind`

Five search terms, deduplicated by `trackId`, grouped by `kind`:

```sh
cd /tmp && rm -f niche.json
for t in "picture+in+picture+safari" "pip+safari" "pipify" "pipbutton" "picture+in+picture"; do
  curl -s "https://itunes.apple.com/search?term=${t}&entity=macSoftware&country=us&limit=50" >> niche.json
  sleep 2
done
jq -s -r '[.[].results[]] | unique_by(.trackId)
  | map(select(.trackName|test("(?i)pip|picture.?in.?picture|overpicture|inpicture")))
  | group_by(.kind) | map({kind:.[0].kind, apps:length, ratings:(map(.userRatingCount//0)|add)})' niche.json
jq -s -r '[.[].results[]] | unique_by(.trackId)
  | map(select(.trackName|test("(?i)pip|picture.?in.?picture|overpicture|inpicture")))
  | sort_by(-(.userRatingCount//0))[]
  | [.trackName,(.formattedPrice//"?"),.kind,((.features//[])|join("+")),(.userRatingCount//0),.releaseDate[0:7]] | @tsv' niche.json
```

```
[
  {
    "kind": "mac-software",
    "apps": 19,
    "ratings": 0
  },
  {
    "kind": "software",
    "apps": 4,
    "ratings": 18
  }
]
OverPicture for Safari	$3.99	software	iosUniversal	12	2016-12
PiPButton	$1.99	software	iosUniversal	3	2022-10
Picture in Picture Assistant	Free	software	iosUniversal	2	2026-02
Picture in Picture for Safari	$2.99	software	iosUniversal	1	2025-11
inPicture for Safari	$0.99	mac-software		0	2016-10
PiPifier	Free	mac-software		0	2016-09
PiPer	Free	mac-software		0	2018-12
miniVideo - Picture in Picture	Free	mac-software		0	2019-10
Floating: Picture in Picture	Free	mac-software		0	2020-04
Pip Me • Picture in Picture	$2.99	mac-software		0	2020-08
Pippo - PiP Seeking controls	$1.99	mac-software		0	2021-11
PiPify	Free	mac-software		0	2023-03
PIP Master	$0.99	mac-software		0	2023-09
Picture-in-picture : OnScreen	Free	mac-software		0	2023-11
Peep - PiP Browser	Free	mac-software		0	2025-04
Picture-In-Picture	Free	mac-software		0	2024-01
Picture-in-picture (PiP)	$0.99	mac-software		0	2024-09
Picture-in-Picture.	$0.99	mac-software		0	2024-11
Picture-in-Picture Player	$0.99	mac-software		0	2025-02
Picture in Picture	Free	mac-software		0	2026-01
MenuPiP	Free	mac-software		0	2026-03
Universal PiP for Safari	Free	mac-software		0	2026-06
Pipify	Free	mac-software		0	2026-06
```

The split is the whole story: **all 4 apps with any rating are `iosUniversal`; all 19
`mac-software` apps report exactly 0.** So:

- **"18 ratings across the niche" is not a niche total**, and **"nineteen have never been
  rated" would be false.** The 18 is the sum of four universal apps' **iOS** ratings; the
  other nineteen contribute unknown amounts, not zero — PiPifier is in that group of
  nineteen reporting 0 while its own iOS twin reports 324.
- What survives is **price and existence**: 23 PiP apps found, 13 of them free.
  Restricting to Safari-extension PiP (OverPicture, PiPButton, Picture in Picture
  Assistant, Picture in Picture for Safari, inPicture, PiPer, PiPifier, PiPify, Pipify,
  Picture-In-Picture, Universal PiP) gives eleven apps, **at least five free**, including
  `PiPer` — open source, Safari, same purpose. That is enough to retire the founding
  premise that this capability is otherwise *sold*.

Two caveats on the search command. The name filter is a regex and it is fragile — an
earlier version omitting `overpicture|inpicture` silently dropped the category leader and
reported the ratings sum as `6` instead of `18`. Always sanity-check that OverPicture is in
the output. And the list mixes Safari extensions with standalone PiP utilities (`Peep`,
`Pip Me`, `MenuPiP`, `miniVideo`), which is why the Safari subset above is enumerated by
hand.

### The rule to carry forward

**As of 2026-07-27, Mac App Store competitor volume cannot be measured from here.** Not by
ratings, not by rank, not by a third-party estimator. If a future task needs it, the honest
answer is that it is unavailable *today*, and any strategy that requires the number is a
strategy that cannot be validated. Price, existence, release date and last-update date are
the observable fields. Before repeating that conclusion, **run the canary above.**

---

## 6. Why the third-party download estimates were not credible

The design conversation used third-party estimates of 2 200–20 600 downloads a month for
OverPicture, and the project's founding premise rested on them.

Nobody outside Apple can observe Mac App Store sales — §5 shows even the ratings are
unreadable. So an estimator cannot be observing; it must be fitting a model to category,
rank, price and chart position. **Stated as hypothesis, not measurement:** such models
likely floor their output at a plausible minimum for a *listed, selling* app, so a dormant
listing returns the floor.

What *is* verifiable is that the estimate fails a sanity check. 2 200 a month for 114 months
is a quarter of a million lifetime sales, against 56 observed iOS ratings worldwide (§5).
Even allowing that the Mac side is invisible and could be larger, and that rate-prompt
conversion for small utilities varies over more than an order of magnitude, a
quarter-million-sale app with double-digit ratings on its readable half is not a shape that
occurs.

So: **the estimate is not credible, and it is not possible to say by how much.** Earlier
versions of RRR §1 put a multiplier on the gap — first 1000×, then 10–50× — and both were
overreaching, built on the same unreadable numbers. RRR §1 now carries no multiplier and
neither does this file. Do not reintroduce one.

The transferable lesson: **an estimate that implies an absurd rating rate is not an
estimate**, and before acting on any figure about a competitor, check whether the underlying
quantity is observable at all.

---

## 7. Recorded baseline — 2026-07-27

Take a fresh reading, subtract, and note the date. Every figure below was read by the
command shown in the section named.

| Metric | Value 2026-07-27 | Kind | Source |
|---|---|---|---|
| GitHub zip downloads, all releases | **127** | cumulative | §3 |
| — 1.0 (2022-08-27) | 9 | cumulative | §3 |
| — 1.0.1 (2022-08-29) | 63 | cumulative | §3 |
| — 1.0.2 (2025-10-04) | 33 | cumulative | §3 |
| — 1.0.3 (2025-10-13) | **22** | cumulative | §3 |
| Homebrew installs, 30 d (2026-06-27 … 2026-07-27) | 1 | rate | §2 |
| Homebrew installs, 90 d (2026-04-28 … 2026-07-27) | 1 | rate | §2 |
| Homebrew installs, 365 d (2025-07-27 … 2026-07-27) | 5 | rate | §2 |
| Repository stars | 4 | cumulative | §3 |
| Repository forks | 0 | cumulative | §3 |
| GitHub views / unique, 14 d | 0 / 0 | rate | §4 |
| GitHub clones / unique cloners, 14 d | 7 / 5 | rate | §4 |
| GitHub referrers | none | rate | §4 |
| OverPicture: price | $3.99 | observable | §5 |
| OverPicture: on sale since / last updated | 2016-12-30 / 2026-02-06 (v2.7.1) | observable | §5 |
| OverPicture: **iOS** ratings, 162 storefronts | 56 (12 of them US), 23 markets | cumulative, iOS only | §5 |
| OverPicture: **Mac** ratings and Mac sales | **not reported today** | — | §5 |
| PiP apps found on the Mac App Store | 23 (13 free); 11 are Safari PiP, ≥5 free | observable | §5 |
| Any Mac-side rating count, any competitor | **not reported today**; worked until 2024-11 | — | §5 |
| Canary: Amphetamine Mac `aggregateRating` | `ratingValue 0, reviewCount 0` | — | §5 |

One reading differs from PLAN.md T17's, because the counter moved after those were written:
**1.0.3 is 22, not 21**, so the **total is 127, not 126**. That is §3's cumulative-counter
behaviour demonstrating itself inside a single working day — and a reminder that "126"
without a timestamp next to it was already worthless.

The App Store rows deliberately record *unobservability* as the finding. Earlier drafts
recorded "12 US ratings" and "18 ratings across the niche" as competitor facts; both were
artifacts of §5 and are gone. Do not reinstate a Mac-side competitor number here without
first re-checking whether `kind: mac-software` still reports zero.

---

## 8. What these numbers can and cannot tell us

**Our own numbers are real; the competitor's are not available.** §2, §3 and §4 measure
PiPOSS and are trustworthy within their stated biases. §5 measures almost nothing about
competitors. Keep the two apart.

**Ratings, where readable at all, are a proxy for downloads with an unknown and variable
conversion rate.** This file deliberately does **not** convert OverPicture's 56 iOS ratings
into a download estimate. An earlier draft did, producing "roughly 10 to 900 a month" from
an uncited assumed rate of 1 rating per 20 to 1 per 2000 installs — iOS-only ratings
answering a question about Mac. Three compounding unknowns do not make a range. If someone
needs a competitor volume figure, the answer from this file is: **it is not obtainable
today** — see §5, including its canary for the day that changes, and §6.

Direction of error, per source:

| Source | Error | Why |
|---|---|---|
| Homebrew analytics | **under** | Opt-out; an unknown share disable it. Excludes everyone who downloads the zip. |
| Homebrew analytics | **over**, at our scale | Counts the developer's own installs. At a count of 1, that is 100% of the signal. |
| GitHub release downloads | **over** | Bots, mirrors, scrapers, CI. No dedup by user. Never reset, so junk accumulates indefinitely. |
| GitHub release downloads | **under** | Counts downloads, not installs; and a user upgrading via brew never touches the asset. |
| GitHub stars | **unrelated** | Measures developer attention, not user demand. 4 stars is not 4 users. |
| GitHub traffic | **unusable at this volume** | 0 views alongside 5 unique cloners; see §4. |
| Mac App Store ratings | **unavailable today** | `kind: mac-software` returns 0 for everything since some point after 2024-11; run §5's canary before assuming it still does. |
| iOS ratings of universal competitors | **under ≈5× if read US-only** | Per-storefront; US is 12 of 56. |
| iOS ratings of universal competitors | **wrong platform** | Says nothing about Mac, which is the question. |
| Third-party download estimators | **over, by an unknown factor** | Model output, not observation; see §6. |

---

## 9. How to judge whether a change worked

The baseline is **one to five installs a month**. Honest arithmetic before any dashboard: a
Poisson count with a mean of ~2 per month has a standard deviation of ~1.4. Two
consecutive months of 2 and 4 is not growth; it is the same process twice. To distinguish a
50% improvement (2 → 3 per month) from noise at any useful confidence you would need to
accumulate on the order of a hundred events — **years** at this rate. To detect a doubling
you would still need roughly a year.

Therefore:

- **Nothing incremental in v2 is measurable.** A better toolbar button, a configurable
  hotkey, a fixed YouTube button, a rename — each is the right thing to do on its merits,
  and none will produce a signal you can tell from noise. Do not attribute a change in the
  numbers to any of them, and do not let the absence of a signal be read as the change
  having failed.
- **The only thing this measurement can resolve is a step change:** a 10× or better shift
  arriving within days. Realistically that means App Store presence (RRR §11 keeps it
  prepared, unsubmitted), or a launch post that lands somewhere Mac users actually read. A
  step change is visible in the very first reading after the event and needs no statistics.
- **When you attempt one, take a reading immediately before** and write the date next to
  it. §3 is cumulative; without a pre-event reading the event is unmeasurable afterwards,
  permanently. This is the single most valuable operational habit in this document.
- **Watch the referrer list in §4 around a launch.** It is the only source here that names
  *where* attention came from, and a named referrer with a real count is the earliest
  confirmation that a post landed.
- **Prefer the Homebrew 30 d window as the headline number** once it exceeds about 20. It
  is natively a rate, deduplicated per machine, and far less polluted by bots than the
  release counters. Below 20 it is dominated by the caveats in §2.
- **Do not benchmark against a competitor.** Per §5 there is no competitor number to
  benchmark against, and comparison against an unobservable quantity is how this project
  acquired a wrong premise twice.
- **Do not build a dashboard.** Four numbers read by hand from §1 twice a year, each with
  its date, are a better instrument than a trend line drawn through noise — a chart of this
  data would show slope where there is none. This is also why DECISIONS.md item 4 rules out
  the scheduled job: automating the collection would not make the numbers mean more, and it
  would create a standing invitation to over-read them.
