# Naming shortlist

**Status: decision document. Nothing here is applied.** RRR §11 and DECISIONS.md entry 5
settle it: in v2 the bundle ids (`org.artginzburg.PiPOSS`,
`org.artginzburg.PiPOSS.Extension`), the repository URL, and the Homebrew cask
`artginzburg/tap/piposs` do not change. Every candidate below is therefore a **display
name** — `CFBundleDisplayName`, the `extension_name` string, the README heading, and a
future Mac App Store title. Nothing more.

Today the display name is `PiPOSS` in three places, verified read-only:

```
$ grep -rn "INFOPLIST_KEY_CFBundleDisplayName" PiPOSS.xcodeproj/project.pbxproj
472:    INFOPLIST_KEY_CFBundleDisplayName = "PiPOSS Extension";
506:    INFOPLIST_KEY_CFBundleDisplayName = "PiPOSS Extension";
552:    INFOPLIST_KEY_CFBundleDisplayName = PiPOSS;
601:    INFOPLIST_KEY_CFBundleDisplayName = PiPOSS;
$ python3 -c "import json; print(json.load(open('PiPOSS Extension/Resources/_locales/en/messages.json'))['extension_name'])"
{'message': 'PiPOSS', 'description': 'The display name for the extension.'}
```

---

## 1. Read this before the table: what the name cannot fix

The framing for this task was 127 GitHub downloads in four years against a paid competitor
doing "2.2k–20k downloads per month". **That comparison does not survive a check**, and the
check does not belong here: the competitive premise is **RRR §1**'s and the measurements are
[`metrics.md`](metrics.md) §5–§6's. Per those two, the estimates are modelled category
floors rather than observations, Mac App Store competitor volume is **not measurable at all**
from here, and RRR §1 therefore carries **no multiplier** for the gap to the category leader.

**Earlier drafts of this document back-projected competitor sales from rating counts and
reported gaps of 20×–100×, then 10–50×, and a band of ~60–430 installs a month. All of that
is retracted** — the method assumes a rating-to-install rate transferable from categories
where it has been measured to a $3.99 Mac utility where it has not, and the ratings it rested
on turned out to be the competitor's **iOS** ratings. Nothing below rests on any of it, and
whatever the App Store is worth here is unmeasured — which lowers the value of the exercise
below rather than raising it.

Against that, my estimate of what a rename buys:

| Cause | Plausible share of the gap | Fixed by a rename? |
|---|---|---|
| **Category awareness — most Mac users do not know Safari can do this for arbitrary video at all.** RRR §1's central conclusion: the binding constraint is demand *creation*, and it outranks App Store keyword work | **the dominant term, and it bounds every row below** | No — and a rename cannot create a category |
| Distribution channel — GitHub zip + a Homebrew tap reach developers; the App Store reaches everyone, and Safari's Extensions gallery links only to App Store apps | **60–75% of the remainder** | No |
| Zero discoverable search surface — no App Store listing at all, so no App Store search, no screenshots, no ratings | **15–25% of the remainder** | Partly: a name only matters once there is a listing |
| The name itself — unsearchable, unpronounceable, unshareable | **10–20% of the remainder** | Yes |
| Product quality / bounce | small in v2 (this is what the rest of v2 fixes) | No |

**A rename plausibly addresses 10–20% of the remainder after category awareness is
accounted for, and most of that share is contingent on an App Store submission that RRR
§11 has deferred.** Until the app is in the App Store, the name change is worth roughly
what a better README headline is worth. RRR §1 keeps the rename at "marginal"; this
document agrees, and is cheap to produce for exactly that reason.

Two further honest notes:

- **The keyword problem is partly solvable without renaming.** The Mac App Store title
  field is 30 characters. `PiPOSS: Picture in Picture` is 26 and carries the whole keyword.
  The bare word `PiPOSS` is bad for search; the *title* need not be the bare word. This
  materially weakens the case for renaming, and it is the strongest argument for the status
  quo row below.
- **The read-aloud problem is not solvable that way.** "PiPOSS" said out loud in English
  lands on "pee-poss" / "pip-oss" and neither is a thing anyone will repeat to a friend.
  Word-of-mouth is the one channel a title field cannot reach.

## 2. What a rename costs here

| Asset | Cost if the display name changes | Cost if the *identity* changes too |
|---|---|---|
| Bundle ids | none — display name is independent | Safari treats a new extension id as a **different extension**: every user must re-enable it and re-grant host permissions, and all `browser.storage.local` settings are orphaned |
| Homebrew cask `artginzburg/tap/piposs` | none — cask token can stay while `name` changes | rename the token → `brew upgrade` silently stops finding it for existing installs unless an `old_tokens` stanza is added and the tap keeps a shim |
| Repository URL | none — GitHub keeps redirecting | GitHub redirects `git remote` and web URLs, but the README badge URLs, the release-asset path in the README download link, and the cask `url` all hardcode `PiPOSS.zip` and must change together |
| The 127 recorded downloads (**downloads, not users** — the installed base is unknown and certainly smaller) | they see a new name in Safari's extension list; mildly confusing, harmless | they must re-enable and re-configure; realistically some fraction is lost |
| Signing / notarization | none | new bundle ids need new provisioning; notarization is per-submission anyway |

RRR §11 already fixes this: **display name only.** The rows below marked "would tempt a
full rename" are the ones where keeping `PiPOSS` in the bundle id and cask starts to look
inconsistent enough that a future owner would be pulled into the expensive version. That is
a cost of the candidate, and it is priced in.

## 3. Method

Three checks per candidate. Raw output for all of them is in §7.

**On the choice of method:** PLAN.md T19 prescribes no particular DNS or WHOIS technique —
it requires only that "every availability claim is backed by a check that was actually
run". `grep -rniE "\bdig\b|whois|rdap" PLAN.md RRR.md DECISIONS.md` returns no matches.
RDAP-over-`dig` was therefore my decision, made for the reasons in point 2. (An earlier
draft asserted that "the PLAN's `dig` step is unrunnable"; that was false and is retracted.)

1. **App Store collision** — public iTunes Search API, `entity=macSoftware` and
   `entity=software`, `country=US`, `limit=10`. The API returns fuzzy matches, which is
   useful here: querying unrelated words like `PiPWide` still surfaced `OverPicture`,
   `PiPer`, `PiPify` and `Pip Me`, so the PiP-adjacent corner of the store is small enough
   that the API reliably shows it. A query returning **no app bearing the name** is
   therefore decent evidence of no collision, not just an absence of evidence.
2. **Domain availability — RDAP, and only RDAP**, over the endpoints IANA's bootstrap file
   names. **404 = not registered, 200 = registered**; read a 404 as "registrable", not
   "free", because premium pricing and registry reservations are not visible over RDAP. Two
   reasons no availability claim here cites `dig`: **`A`-record answers are synthetic on
   this machine**, and NXDOMAIN does not mean unregistered — a registered domain with no
   delegated nameservers answers NXDOMAIN too. Rcodes *are* truthful, so DNS corroborates
   the RDAP results without deciding them. All of it, with the endpoint discovery and the
   positive and negative controls, is in **§7.4**.
3. **Search-term carrying and read-aloud** — judged on the realistic 30-char title plus
   30-char subtitle pair, not the bare word. Character counts below are exact. "for Safari"
   in a title is demonstrably permitted: `OverPicture for Safari`, `AdBlock Pro for Safari`,
   `Super Agent for Safari` and `Picture in Picture for Safari` all ship today.

**Two things I did not verify. Both matter before anyone acts on this file.**

**1. No trademark register was searched — for any candidate.** Every check in this document
is an App Store listing check or a DNS/RDAP registration check. Neither is a trademark
search, and a name can be free on both and still be somebody's registered mark. Three
public endpoints were attempted and all three failed, so this is unsearched rather than
searched-and-clear:

```sh
curl -s -o /dev/null -w "%{http_code}" "https://tmsearch.uspto.gov/api/v1/tmsearch?query=pipanywhere"
# 404   body: <Error><Code>NoSuchKey</Code>…   (no such public API)
curl -s -o /dev/null -w "%{http_code}" "https://developer.uspto.gov/ibd-api/v1/application/publications?searchText=pipanywhere"
# 301   (redirect, no usable payload)
curl -s -o /dev/null -w "%{http_code}" "https://euipo.europa.eu/copla/trademark/data?query=pipanywhere"
# 000   (no response)
```

USPTO TESS/TSDR and EUIPO eSearch need an interactive session or an API key, neither of
which is available here. **Anywhere this document calls a name "clean", read it as "clean on
the checks listed in §3".** A USPTO and EUIPO search on the chosen name is a prerequisite
for adopting it, and it is the owner's to run.

**2. Whether App Store Connect refuses a name another developer has reserved.** `PiPify`
(id `6446433053`) and `Pipify` (id `6780877040`) both exist on the Mac App Store, which
suggests the check is at most case-sensitive — but the reservation dialog cannot be tested
without a submission. Treat "an app with this name exists" as a commercial problem,
confirmed; treat "the name will be rejected" as unverified.

---

## 4. The candidates

Collision column: **exact** = an app of that name exists; **near** = a confounding name in
the same category; **clear** = the query surfaced no app bearing the name.

| # | Display name | `.com` | `.app` | Collision | Search terms | Read aloud | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **PiPOSS** (status quo) | 200 taken | **404** | clear | none in the word; full keyword available in the title | bad — "pee-poss"; unspellable from speech | keep-able, see §5.1 |
| 2 | **PiP Anywhere** | **404** | **404** | clear | "pip" + the promise; "anywhere" is what users actually want | good, two obvious syllable groups | **recommended** |
| 3 | **AnyPiP** | 200 taken | **404** | **clear — zero results, both entities** | "pip" + "any" | good, slight "any-pip" stumble | strong runner-up |
| 4 | **FloatPiP** | **404** | **404** | clear | "pip" + "float"/"floating video" | good | strong runner-up |
| 5 | **OpenPiP** | 200 parked | **404** | clear | "pip" + carries the open-source story | good | good, see §5.5 |
| 6 | **PiP Everywhere** | **404** | **404** | clear | strongest keyword load of the set | fine spoken | domain reads wrong, §5.6 |
| 7 | **JustPiP** | 200 taken | **404** | clear | "pip"; "just" reads as minimal/free | good | fine, mildly weaker |
| 8 | **Popout** | 200 taken | 200 parked | near (`PopOut`, id 1369753804, iOS) | "pop out video" is a real query; no "pip" | very good | plain-English option, §5.8 |
| 9 | **FloatUp** | 200 taken | 200 taken | clear on Mac (0 results) | "float" only; no "pip", no "video" | good | weak — both domains gone |
| 10 | **Peek** | 200 taken | 200 taken | near — 10+ Mac apps, `Peek — A Quick Look Extension` etc. | **none** | excellent | rejected, §5.10 |
| 11 | **PiPify** | 200 taken | 200 taken | **exact ×2** — `PiPify` 6446433053, `Pipify` 6780877040, plus `PiPifier` 1160374471 | good | good | **disqualified** |
| 12 | **PiPer** | 200 taken | 200 taken | **exact** — `PiPer` 1421915518, a free Safari PiP extension (site-specific, last shipped 2019) | good | good | **disqualified** |

### Title + subtitle pairs, exact character counts (limit 30 / 30)

| Candidate | Title | Len | Subtitle | Len |
|---|---|---|---|---|
| PiPOSS | `PiPOSS: Picture in Picture` | 26 | `Float any web video in Safari` | 29 |
| PiP Anywhere | `PiP Anywhere` | 12 | `Picture in Picture, any video` | 29 |
| AnyPiP | `AnyPiP: Picture in Picture` | 26 | `Float any video out of Safari` | 29 |
| FloatPiP | `FloatPiP — Picture in Picture` | 29 | `Any web video, floating on top` | **30 — at the cap, zero headroom** |
| OpenPiP | `OpenPiP: Picture in Picture` | 27 | `Free, open source, any video` | 28 |
| PiP Everywhere | `PiP Everywhere` | 14 | `Picture in Picture, any video` | 29 |
| JustPiP | `JustPiP: Picture in Picture` | 27 | `Any web video, one keypress` | 27 |
| Popout | `Popout: Picture in Picture` | 26 | `Float any web video in Safari` | 29 |

All fit, and the keyword is carried by the title in every case — which is §1's point: the
bare word matters much less than it feels like it does.

One flag: **`FloatPiP`'s subtitle is exactly 30 characters** — it lands on Apple's cap with
nothing to spare, so any later wording change or localisation breaks it. Every other pair
has at least one character of slack. Not disqualifying, but if `FloatPiP` is chosen, pick a
shorter subtitle up front.

## 5. Per-candidate notes

### 5.1 PiPOSS — status quo, and a better row than it looks

`itunes.apple.com/search?term=PiPOSS&entity=macSoftware` returns `resultCount=0`;
`entity=software` returns two unrelated results (`World of Pippi Longstocking`, `Pipal`). So
there is **no App Store collision at all** — an advantage four of the eleven other
candidates cannot match (`Popout` and `Peek` near, `PiPify` and `PiPer` exact, per §4).

*No trademark register was searched for this or any candidate — see §3.*

`piposs.app` is **not registered** (RDAP 404). `piposs.com` **is** registered, and it is
worth following properly, because Verisign is a **thin registry**: it stores no contact
objects at all, so "RDAP redacts the registrant" was the wrong mechanism even though it was
right in effect. The registry record carries a `links[rel=related]` referral to the
registrar, which does hold contacts:

```
$ curl -s https://rdap.verisign.com/com/v1/domain/piposs.com | jq '.links'
  self    → https://rdap.verisign.com/com/v1/domain/PIPOSS.COM
  related → https://rdap.ionos.com/domain/PIPOSS.COM        ← follow this
$ curl -s https://rdap.ionos.com/domain/PIPOSS.COM                    # HTTP 200
  registration 2026-01-26T18:37:08Z   registrar expiration 2027-01-26T18:37:08Z
  last changed 2026-01-26T18:43:55Z   (six minutes after registration)
  entity roles=[registrant]  status=["removed"]  fn=""  adr={cc: "GB"}, region "BNE"
    contact-uri  mailto:dataprivacyprotected@ionos.de
    remarks: "REDACTED FOR PRIVACY", "EMAIL REDACTED FOR PRIVACY"
  secureDNS: delegationSigned=false
$ dig +short piposs.com TXT   → "v=spf1 include:_spf-eu.ionos.com ~all"
$ dig +short piposs.com MX    → 10 mx00.ionos.co.uk.  10 mx01.ionos.co.uk.
$ curl -s -o /dev/null -w "%{http_code}" https://piposs.com   → 525
```

**What this establishes.** Registered 2026-01-26 on a one-year term through IONOS, edited
six minutes later, and configured for **email**: IONOS's European SPF include and IONOS UK
mail exchangers. DNS is delegated to Cloudflare, and the **HTTP 525** is a Cloudflare TLS
handshake failure with the origin, meaning Cloudflare is in front of nothing. So: somebody
wanted mail at this domain and has not put up a site.

**What stays unknowable: the registrant.** `fn` is empty and the contact is IONOS's privacy
proxy (`dataprivacyprotected@ionos.de`), so `cc: "GB"` and the `"BNE"` region string
plausibly describe **the proxy, not the holder**. They are not identification and must not
be read as such.

**The one-question test for the owner:** *do you have an IONOS account with mail configured
on `piposs.com`?* If yes, this is you and there is nothing to see. If no, someone registered
this project's exact name in January 2026 and pointed mail at it — worth knowing before
announcing any name at all.

"Picture in Picture Open Source Software" is a genuinely good story and should stay in the
README either way. The case against the word is narrow and real: it is unspellable from
speech, so it cannot travel by word of mouth.

**Cheapest honest option: keep `PiPOSS` and fix the title.** Ship the App Store title as
`PiPOSS: Picture in Picture` and the README subhead as "Picture in Picture for any video, on
any site". That recovers most of the search value at zero cost and zero risk to the 127
recorded downloads. If the owner does not want to spend a decision here, this is the default
and it is defensible.

### 5.2 PiP Anywhere — recommended

The only candidate with **both** domains registrable and **no** collision of any kind:

```
pipanywhere.com  RDAP 404      pipanywhere.app  RDAP 404
term=PiP Anywhere entity=macSoftware → resultCount=1, 'Remio - Remote Desktop'  (unrelated)
term=PiP Anywhere entity=software    → resultCount=7, none bearing the name
```

"Anywhere" is the actual product claim — the differentiator against every site-specific PiP
tool — and it is a word people type. Two words, twelve characters, unambiguous when spoken,
spellable when heard. The one weakness is that it is descriptive rather than brandable.
Descriptive marks are generally harder to protect — but **no register was searched, so treat
that as a general expectation and not a finding about this name** (§3). For a free
open-source utility with no brand to defend it is close to irrelevant either way.

Would it tempt a full rename? **Mildly.** `org.artginzburg.PiPOSS` next to a "PiP Anywhere"
display name is a normal, unremarkable mismatch — plenty of shipping apps do this.

### 5.3 AnyPiP — strongest runner-up

The cleanest collision result in the entire set: `resultCount=0` for **both**
`entity=macSoftware` and `entity=software`. `anypip.app` is registrable (404). `anypip.com`
is taken — registered 2026-02-27 at Cloudflare, so recent and likely held, not parked for
sale.

Shorter and more brandable than `PiP Anywhere` while carrying the same idea. It loses on the
domain and gains on distinctiveness; if the owner prefers a one-word mark, this is the pick.

### 5.4 FloatPiP — strongest runner-up on domains

Both registrable, confirmed twice:

```
floatpip.com  RDAP 404
floatpip.app  RDAP 404   body: "floatpip.app not found"
```

No app bears the name (the fuzzy results were WebP converters and boat games — the API had
nothing better to offer, which is the signal). Carries **two** search clusters, "pip" and
"float"/"floating video", where the others carry one.

Two costs. First, `FloatPlay - floating play` (id `6755531330`, $1.99) exists on the Mac App
Store — not a name collision, but a near neighbour in exactly this niche. Second, the
internal capital P reads awkwardly in body text, and lowercase `floatpip` has a mild
letter-soup quality.

### 5.5 OpenPiP — good, with a domain caveat

No collision (the fuzzy results were WebP converters and Raspberry Pi tools). `openpip.app`
registrable. `openpip.com` is registered and, from the RDAP record, **parked for resale**:

```
registration 2020-07-16  expiration 2027-07-16  registrar=GoDaddy.com, LLC
nameservers=NS1.AFTERNIC.COM, NS2.AFTERNIC.COM
```

Afternic nameservers mean a broker listing. Buyable, at broker prices — which for a project
whose whole point is being free is the wrong trade. Take `.app` and ignore `.com`.

The name folds the open-source story into the mark, which is the one thing `PiPOSS`
genuinely does well, without inheriting its unpronounceability. It is also the candidate
that **would most tempt a full rename**, because "OpenPiP" invites
`org.artginzburg.OpenPiP` and a matching cask token, and RRR §11 says no. Priced as a real
cost.

### 5.6 PiP Everywhere — best keywords, bad domain

Both domains registrable (`.com` 404, `.app` 404) and no collision. Strongest keyword load
of the twelve.

But the domain is `pipeverywhere.app`, which reads as **"pipe-verywhere"**. A hyphen fixes
the URL and creates a worse one. Fourteen characters is also long for a display name that
has to sit in Safari's extension list. Good name, bad address.

### 5.7 JustPiP — fine, slightly weaker

No collision; `justpip.app` registrable. `justpip.com` has been held since 2008-03-24
(eNom, Cloudflare NS) and expires 2028 — long-held, not for sale. "Just" reads as "nothing
but this, no bloat", which suits a free tool. It carries less than `PiP Anywhere` because
"just" is not a term anyone searches.

### 5.8 Popout — the plain-English alternative

The only candidate a non-technical person would produce unprompted. "Pop out video" is a
genuine query pattern; Chrome and Firefox users know the phrase from those browsers' own UI.
Excellent aloud.

Costs: no "pip" in the word at all, so it depends entirely on the subtitle carrying the
keyword; a near-collision with `PopOut` (id `1369753804`, iOS Social Networking) plus
`Popout Timer & Stopwatch` (id `6754604148`) on the Mac Store; and `popout.app` is
**registered and brokered** (registered 2026-03-23, Sav.com, `ns1/ns2.afternic.com`). Both
domains cost money.

Worth keeping on the list because it is the only row optimised for the channel this project
actually has today — a human telling another human. If the App Store never happens, this is
arguably the better name.

### 5.9 FloatUp — weak

Clear on the Mac App Store (`resultCount=0` for `entity=macSoftware`), which is its only
strength. Both domains are taken and both look held: `floatup.com` since 2006-01-13
(GoDaddy), `floatup.app` since 2026-03-27 (GoDaddy). Carries neither "pip" nor "video".
Listed for completeness; do not pick it.

### 5.10 Peek — rejected on the evidence

Pronounceable, memorable, and completely wrong. Ten Mac App Store results for `Peek`
including `Peek — A Quick Look Extension`, `Folder Peek`, `File Peek`, `Peek by Cherrium`,
`Peek: AI API Monitoring`, and ten more on iOS. Both domains long taken. Carries **zero**
search terms — a pure brand play, which is exactly what a project with no marketing budget
cannot afford. It is in the table as the cautionary row: this is what "nice name" looks like
when you check it.

### 5.11 PiPify — disqualified

Exact collision, twice, on the platform that matters:

```
'PiPify'   id 6446433053  Arnaud Nommay   Mac App Store, Productivity, Free
'Pipify'   id 6780877040  Sander van Tol  Mac App Store, Productivity, Free
'PiPifier' id 1160374471  Arno Appenzeller  Mac App Store, Utilities, Free
```

`PiPifier` is the well-known open-source Safari PiP extension. Shipping a third `PiP*ify`
into that cluster would put this project into a name fight it has no reason to enter. Both
domains taken. Out.

### 5.12 PiPer — disqualified, and the most instructive row

`PiPer` (id `1421915518`, Adam Marcus, Mac App Store, Utilities, Free) is a free
open-source Safari extension that adds Picture in Picture. Same platform, same name,
overlapping function — that alone disqualifies the name.

But the comparison must be exact, and an earlier draft called it "exactly this product",
which concedes something untrue. From its own listing:

```
$ curl -s -G "https://itunes.apple.com/lookup" --data-urlencode "id=1421915518" --data-urlencode "country=us"
trackName=PiPer   sellerName=Adam Marcus   formattedPrice=Free
primaryGenreName=Utilities   minimumOsVersion=10.12   userRatingCount=0
releaseDate=2018-12-01T19:09:46Z   currentVersionReleaseDate=2019-11-14T00:53:47Z   version=1.0.4
description: "adds Picture in Picture functionality to YouTube, Netflix,
              Amazon Video, Twitch, and more!  … Adds a dedicated Picture in
              Picture button to the video player of supported sites"
```

`PiPer` is **site-specific** — its own description says so ("of supported sites") — and was
last released **2019-11-14** at v1.0.4. PiPOSS works on *any* video on *any* site, which is a
real difference the document should not give away. The name is still unusable; the product
comparison is favourable. (Its `userRatingCount=0` is not evidence of anything — per
metrics.md §5 every `kind: mac-software` record reports zero.)

The same query run for `PiPWide` — a nonsense word — returned the whole neighbourhood, and
it is worth reading as a map of the competition:

```
'PiPer'                          1421915518  Free
'OverPicture for Safari'         1188020834  $3.99
'Fenêtre'                        1286743037  $7.99
'Picture in Picture for Safari'  6755545186  $2.99
'Pip Me • Picture in Picture'    1527125770  $2.99
'Pippo - PiP Seeking controls'   1594356631  $1.99
'PiPify'                         6446433053  Free
```

**The Mac App Store PiP niche runs to a dozen-plus apps, and at least five of them are
free** — consistent with RRR §1 and metrics.md §5. Free entries surfaced directly here:
`PiPer` 1421915518, `PiPify` 6446433053, `Pipify` 6780877040, `PiPifier` 1160374471,
`Picture-In-Picture` 6475380719, `Floating: Picture in Picture` 1508833245,
`Picture-in-picture : OnScreen` 6469731201. Paid: `Fenêtre` $7.99,
`OverPicture for Safari` $3.99, `Picture in Picture for Safari` $2.99, `Pip Me` $2.99,
`PiPButton` $1.99, `Pippo` $1.99, `Picture-in-picture (PiP)` $0.99. (An earlier draft said
"at least seven apps, two of them free", undercounting the free tier badly.)

So the free-and-open-source angle is true but **not a differentiator** — a naming document
that implied otherwise would mislead the owner into pricing his advantage where he does not
have one. The real differentiators are RRR §4's: any site rather than a supported list, a
configurable hotkey, a working YouTube button, auto-PiP on tab hide. `PiPer`'s
seven-year-stale, site-specific listing is the concrete evidence that "any video anywhere"
is the claim worth making.

## 6. Checked and rejected before reaching the table

All rejected on checks that were run; output in §7.

- **Picture in Picture for Safari** — `Picture in Picture for Safari`, id `6755545186`,
  $2.99, already on the Mac App Store. Also purely generic.
- **Always On Top** — `AlwaysOnTop` (id `6738742877`, $1.99) plus `KeepTop: Always On Top`,
  `Hover - Always on Top Windows`, `WindowPin`, `TopWindow`. Crowded, and the phrase means
  *windows* on top, not video in PiP — wrong concept, wrong searchers.
- **VidFloat** — `VidFloat - PiP Video Player`, id `6788296165`, Photo & Video. Exact name,
  same function. **The collision is on iOS, not the Mac** — it surfaces only under
  `entity=software`; `entity=macSoftware` returns just `VidHub` and `CodecLens`, as §7.1
  shows. Out anyway: an exact-name PiP player one storefront away is a name fight either
  way, and RRR §11 **freezes** the iOS/iPadOS target, unfreezing it only if the owner
  decides to submit — so the collision sits on a storefront this project may yet enter.
  Rejected despite both domains being registrable (`.com` 404, `.app` 404), which makes it
  the most expensive miss on this list.
- **Floaty** — `Floaty App` ($6.99), `Floaty Lite – Pin Windows`, `FloatyDo`, `Floati`,
  `Floaty!`, `Floaty: VESC Stats`. Saturated; both domains taken.
- **Miniplayer** — no exact Mac collision, but the term is owned by music players in
  practice (`MiniPlay for Spotify & iTunes`, `MiniPlayer Widget`,
  `Mikron - Mini Player for Music`). Searchers arriving on it want Spotify.
- **FloatPlayer / Floating Video** — `FloatPlay - floating play` ($1.99) and, for "Floating
  Video", a wall of teleprompter apps. "Floating" as a search term is contaminated by
  teleprompters and floating cameras.
- **PiPUp** — `Pip Up: Persist/Float Post-It` (id `6483210322`) exists; the macSoftware
  query returned only ad blockers, meaning the API had no match at all for the string.
- **Pipster** — `Pipster Security - VPN Proxy` (id `6740810340`) on the Mac App Store and
  `Pipster` (id `6780278380`, Finance). "Pip" in finance means something else entirely;
  forex apps own this word.
- **PiPFree** — no collision, but price words in app names are the wrong move for App Store
  metadata, and it reads as adware.
- **VideoPop, PopPiP, PiPWide** — no meaningful results; discarded as weak names rather than
  on collisions. `PiPWide` was kept only as the probe query in §5.12.

## 7. Verification log

Every claim above traces to one of these. Reproduce with the commands as written.

### 7.1 App Store collisions

```sh
curl -s -G "https://itunes.apple.com/search" \
  --data-urlencode "term=<NAME>" --data-urlencode "entity=macSoftware" \
  --data-urlencode "limit=10" --data-urlencode "country=US"
# repeated with entity=software; 3s between calls; all returned HTTP 200
```

| term | `entity=macSoftware` | `entity=software` |
|---|---|---|
| `PiPOSS` | **0** | 2 — `World of Pippi Longstocking`, `Pipal` |
| `PiP Anywhere` | 1 — `Remio - Remote Desktop` | 7 — none bearing the name |
| `AnyPiP` | **0** | **0** |
| `FloatPiP` | 4 — WebP/vector converters | 4 — games |
| `OpenPiP` | 10 — WebP converters, `Blink Pro`, `Dataplicity` | 8 — VPN and Raspberry Pi apps |
| `PiP Everywhere` | **0** | 1 — `PiPa Tuner-Tuner for PiPa` |
| `JustPiP` | **0** | 1 — `Steppi` |
| `Popout` | 6 — `Popout Timer & Stopwatch` 6754604148, `Canva`, `PopFS` | 7 — `PopOut` 1369753804, `PopOutNow`, `POPOUT - Fashion Discovery` |
| `FloatUp` | **0** | 6 — games |
| `Peek` | 10 — `Peek — A Quick Look Extension` 1554235898, `Folder Peek`, `File Peek`, `Peek by Cherrium`, `Peek: AI API Monitoring`, … | 10 — `Peek Professional`, `Peek: Secret Compliment`, … |
| `PiPify` | 8 — **`PiPify` 6446433053**, **`Pipify` 6780877040**, `PiPifier` 1160374471, `OverPicture for Safari` 1188020834, `PiPer` 1421915518, `Picture in Picture for Safari` 6755545186, `PiPButton` 1589668699, `Picture-in-picture : OnScreen` 6469731201 | 10 — `PiPifier`, `PiP-it!`, `CornerTube - PiP for YouTube` $4.99, … |
| `PiPer` | 9 — **`PiPer` 1421915518**, `Piper` 493819273 $1.99, `Piper - Neural TTS` | 10 — mostly `Paper.io` noise |
| `Picture in Picture` | 9 — `Picture-In-Picture` 6475380719, `Floating: Picture in Picture` 1508833245, `PiPifier`, `PiPer`, `Picture-in-picture (PiP)` 6670415844, `OverPicture for Safari` | 10 — `PiP - Picture in Picture` 1635796246, `YubePiP`, … |
| `Always On Top` | 10 — `AlwaysOnTop` 6738742877 $1.99, `KeepTop: Always On Top` 6739556266, `Hover - Always on Top Windows` 1502873830 $4.99, `Hang - Video Always On Top` 1050779754, `Pipper` 1587335166 | 9 — `Always On Top - PDF/Web/Images` 6747107679, `Pip Up` 6483210322 |
| `VidFloat` | 3 — `VidHub`, `CodecLens` | 9 — **`VidFloat - PiP Video Player` 6788296165** |
| `Floaty` | 4 — `Floaty Lite – Pin Windows` 6755633285, `FloatyDo`, `Floaty App` 1555987711 $6.99, `Floati` | 7 — `Floaty: VESC Stats`, `Floaty!`, … |
| `Miniplayer` | 9 — `MiniPlay for Spotify & iTunes`, `MiniPlayer Widget`, `Mikron - Mini Player for Music` | 9 — `Pip - Video Player` 6444033332, `Bro Browser - PiP Video Player` |
| `FloatPlayer` | 9 — **`FloatPlay - floating play` 6755531330 $1.99**, `Infuse`, `Elmedia` | 10 — unrelated players |
| `Floating Video` | 10 — `Floating: Picture in Picture` 1508833245, teleprompters, `FloatPlay` | 10 — `Floating Video and YouTube` 1385741964, `YubePiP`, `YouTube PiP Floating Player` |
| `PiPUp` | 9 — ad blockers only | 10 — `Pip Up: Persist/Float Post-It` 6483210322 |
| `Pipster` | 1 — `Pipster Security - VPN Proxy` 6740810340 | 5 — `Pipster` 6780278380 (Finance) |
| `PiPFree` | 1 — `PiPer` 1421915518 | 5 — `Picture in Picture - Great Free Image Effects` 1068234956 |
| `VideoPop` | 10 — unrelated editors | 9 — `VideoPop.ly - All Video Status` 1505308515 |
| `PopPiP` | 4 — games | 6 — games |
| `PiPWide` (probe) | 7 — `PiPer`, `OverPicture for Safari`, `Fenêtre` 1286743037 $7.99, `Picture in Picture for Safari` 6755545186 $2.99, `Pip Me • Picture in Picture` 1527125770 $2.99, `Pippo - PiP Seeking controls` 1594356631 $1.99, `PiPify` | 9 — `PiP Float - Split Screen Multi` 6757326641, `CornerTube` $4.99 |

### 7.2 Domains — RDAP only

```sh
curl -s -o /dev/null -w "%{http_code}" https://rdap.verisign.com/com/v1/domain/<name>.com
curl -s -o /dev/null -w "%{http_code}" https://pubapi.registry.google/rdap/domain/<name>.app
# 404 = not registered   200 = registered
```

| name | `.com` | `.app` |
|---|---|---|
| `piposs` | 200 | **404** |
| `pipanywhere` | **404** | **404** |
| `anypip` | 200 | **404** |
| `floatpip` | **404** | **404** |
| `openpip` | 200 | **404** |
| `pipeverywhere` | **404** | **404** |
| `justpip` | 200 | **404** |
| `popout` | 200 | 200 |
| `floatup` | 200 | 200 |
| `peek` | 200 | 200 |
| `pipify` | 200 | 200 |
| `piper` | 200 | 200 |
| `vidfloat` | **404** | **404** |
| `alwaysontop` | 200 | 200 |
| `pipster` | 200 | 200 |
| `pipfree` | 200 | **404** |
| `overpicture` | **404** | **404** |

Registration detail for the registered names that matter (same endpoints, full JSON body):

| domain | registered | expires | registrar | nameservers | reading |
|---|---|---|---|---|---|
| `piposs.com` | 2026-01-26 | 2027-01-26 | IONOS SE | Cloudflare | held, mail configured, no site — **one-question test in §5.1** |
| `openpip.com` | 2020-07-16 | 2027-07-16 | GoDaddy | `ns1/ns2.afternic.com` | brokered for resale |
| `popout.app` | 2026-03-23 | 2027-03-23 | Sav.com | `ns1/ns2.afternic.com` | brokered for resale |
| `justpip.com` | 2008-03-24 | 2028-03-24 | eNom | Cloudflare | long-held |
| `floatup.com` | 2006-01-13 | 2027-06-01 | GoDaddy | `domaincontrol.com` | held/parked |
| `floatup.app` | 2026-03-27 | 2027-03-27 | GoDaddy | `domaincontrol.com` | held/parked |
| `anypip.com` | 2026-02-27 | 2027-02-27 | Cloudflare | Cloudflare | recently held |
| `pipfree.com` | 2023-01-20 | 2027-01-20 | NameBright | `namebrightdns.com` | parked |

Note `overpicture.com` and `overpicture.app` are both **404** — the paid competitor does
not own its own domain in either TLD. A domain is not the bottleneck it feels like.

### 7.3 Competitor traction

```sh
curl -s -G "https://itunes.apple.com/lookup" \
  --data-urlencode "id=1188020834" --data-urlencode "country=<CC>"
```

`country=us` → `trackName=OverPicture for Safari`,
`sellerName=Pedro Jose Pereira Vieito`, `formattedPrice=$3.99`,
`primaryGenreName=Utilities`, `releaseDate=2016-12-30T19:00:30Z`,
`currentVersionReleaseDate=2026-02-06T21:06:06Z`, `version=2.7.1`,
`minimumOsVersion=16.0`, `averageUserRating=4.25`, `userRatingCount=12`.

**The per-storefront rating sweep is [`metrics.md`](metrics.md) §5's, not this file's** —
56 iOS ratings across all 162 storefronts, complete with zero fetch failures. A nine-market
sample taken here read ~33 and was reported as a total; it was a subset. metrics.md also
establishes the thing that matters more: those are the competitor's **iOS** ratings and its
Mac-side count is not readable at all, so no conclusion about the Mac market can be drawn
from any of them.

`PiPer`'s own lookup, measured for §5.12, is quoted there.

### 7.4 RDAP endpoint discovery, and the DNS controls behind §3's method

Endpoints came from the IANA bootstrap file, not from memory:

```
$ curl -s https://data.iana.org/rdap/dns.json     # HTTP 200
# app → ['https://pubapi.registry.google/rdap/']
# com → ['https://rdap.verisign.com/com/v1/']
```

RDAP controls, all four as expected: garbage `.com` → 404; `apple.com` → 200,
`ldhName=APPLE.COM`, registration `1987-02-19`; garbage `.app` → 404 with body
`"zzqqxxnonexistent99887766.app not found"`; `cash.app` → 200, registration `2018-03-29`.

**`A` answers on this machine are synthetic.** The resolver is a sandbox interceptor
handing out sequential addresses from `198.18.0.0/15`, so a domain that cannot exist and
`apple.com` "resolve" to consecutive addresses:

```
$ grep -i nameserver /etc/resolv.conf          → nameserver 198.18.0.2
$ dig +short zzqqxxnonexistent99887766.com A   → 198.18.0.232
$ dig +short apple.com A                       → 198.18.0.6
$ dig +short google.com A                      → 198.18.0.233
```

**Rcodes and other record types are not synthetic**, which is what lets DNS corroborate:

```
$ dig +noall +comments zzq9x7nonsensegarbage4471.com NS   → status: NXDOMAIN
$ dig +noall +comments pipanywhere.com NS                 → status: NXDOMAIN
$ dig +noall +comments floatpip.app NS                    → status: NXDOMAIN
$ dig +noall +comments pipeverywhere.com NS               → status: NXDOMAIN
$ dig +noall +comments piposs.com NS                      → status: NOERROR
$ dig +short piposs.com NS   → kip.ns.cloudflare.com.  tara.ns.cloudflare.com.
```

Every RDAP 404 in §7.2 re-tested this way came back NXDOMAIN, and `piposs.com` came back
NOERROR with the nameservers its RDAP record names. `TXT` and `MX` for `piposs.com` also
returned real data (§5.1).

---

## 8. Recommendation

### Ship `PiP Anywhere` as the display name — **if** the owner intends to submit to the App Store. Otherwise change nothing but the title string.

The strongest argument: **`PiP Anywhere` is clean on all three checks §3 defines,
simultaneously** — no App Store collision in either entity, `pipanywhere.com` and
`pipanywhere.app` both unregistered per RDAP and both NXDOMAIN by independent DNS check,
the keyword "pip" inside the name, correct on first hearing, correct on first spelling, and
it states the actual differentiator — *any* site, against a shelf of a dozen-plus PiP apps
whose free leader `PiPer` is site-specific and seven years stale.

**It is not alone on the hard checks: `FloatPiP` ties.** Collision clear, `.com` 404, `.app`
404 — on the three checks §3 defines the two are level, and the owner should know that. What
separates them are softer judgements that §4 does *not* score as collisions:
`FloatPlay - floating play` ($1.99) sits next door in exactly this niche, `FloatPiP`'s
subtitle lands on Apple's 30-character cap with zero headroom, and "anywhere" states the
product claim in a word people type while "float" shares its search space with
teleprompters and floating cameras (§6). Those are reasons, not measurements. **If the owner
weighs the `FloatPlay` neighbour as trivial, `FloatPiP` is an equally defensible pick** —
and it is the one candidate that takes both domains.

Of the rest, each fails at least one hard check: `AnyPiP`, `OpenPiP` and `JustPiP` lose
`.com`; `PiP Everywhere` has no clean web address; `Popout`, `Peek` and `FloatUp` have no
domains and, in two cases, no keywords; `PiPify` and `PiPer` are taken outright.

**Caveat carried forward from §3: no trademark register was searched**, so "clean on the
checks in §3" is not "clear to adopt". A USPTO and EUIPO search on `PiP Anywhere` — or on
`FloatPiP`, if that is the pick — is a prerequisite, and it is the owner's to run.

Concretely, and inside RRR §11:

- `CFBundleDisplayName` → `PiP Anywhere` (container app), `PiP Anywhere` for the Safari
  extension listing via `extension_name`.
- Bundle ids, repository, cask token: **unchanged**, per RRR §11. The mismatch between
  `org.artginzburg.PiPOSS` and a "PiP Anywhere" display name is normal and costs nothing.
- Keep `PiPOSS` in the README as the project's origin: "PiP Anywhere — formerly PiPOSS, for
  *Picture in Picture Open Source Software*". The story survives; the unpronounceable word
  stops being the front door.
- Register `pipanywhere.app` before announcing anything. It is a `.app`, so HSTS is
  preloaded at the TLD and it must be served over HTTPS.
- Future App Store listing: title `PiP Anywhere` (12), subtitle
  `Picture in Picture, any video` (29).

**And the counter-recommendation, stated plainly because §1 requires it:** if the App Store
submission is not going to happen, do not rename at all. Set the App Store title string
aside for later, change the README subhead to carry the keywords, and spend the effort on
the submission instead.

The name is worth fixing. It is nowhere near the first thing to fix — per §1 and RRR §1,
demand *creation* outranks everything in this file.

If the owner wants one word rather than two, take **`AnyPiP`** — zero App Store results
anywhere, `anypip.app` registrable, and it says the same thing.
