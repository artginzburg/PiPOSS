# Entering PiP and the user-gesture gate — WebKit source, 2026-07-27

**Conclusion: auto-PiP on tab hide works.** The gate is real, but a single user
gesture opens it permanently for that element, so a `visibilitychange` handler
minutes later is allowed through.

> **This file was wrong on first writing and is kept with its correction visible.**
> The first version concluded "entering PiP needs to happen inside a user gesture"
> and told the owner the feature might be impossible. That was based on two of the
> three functions involved. The third reverses the conclusion. The error and how it
> was made are recorded at the bottom, because the *method* failure is more
> transferable than the fact.

## The three functions, in the order they matter

**1. The gate.** `Source/WebCore/html/HTMLVideoElement.cpp`,
`HTMLVideoElement::setPresentationMode` — what `webkitSetPresentationMode` calls:

```cpp
    bool requiresUserGesture = mode != VideoPresentationMode::PictureInPicture
        || !protect(document())->pictureInPictureElement();
    if ((requiresUserGesture && !protect(mediaSession())->fullscreenPermitted())
        || !supportsFullscreen(videoFullscreenMode))
        return;                       // silently — no throw, no rejection, no log
```

**2. What the gate consults.** `MediaElementSession.cpp:661`:

```cpp
    if (m_restrictions & RequireUserGestureForFullscreen
        && !protect(element->document())->processingUserGestureForMedia())
        return false;
```

and `RequireUserGestureForFullscreen` **is** added on macOS, unconditionally —
`HTMLMediaElement.cpp:713`. The one init-time relaxation (`:758-761`) is
conditional and does not apply by default.

**3. The function that changes the answer.**
`HTMLMediaElement::removeBehaviorRestrictionsAfterFirstUserGesture`
(`HTMLMediaElement.cpp:9037`) strips a mask that **explicitly names
`RequireUserGestureForFullscreen`** (`:9048`). Its call sites are all guarded by
`processingUserGestureForMedia()`: `play()`, the play-promise path,
`prepareForLoad()`, `setVolume`, `setMutedInternal`, the `autoplay` attribute
handler, `audioTrackEnabledChanged`. It sets
`m_removedBehaviorRestrictionsAfterFirstUserGesture` and the restriction is
**never re-added** — only `RequireUserGestureToControlControlsManager` comes back.

**So: the moment the user clicks play (or unmutes, or changes the volume), the
restriction is gone for that element's lifetime, and `fullscreenPermitted()`
returns true from then on — including inside a `visibilitychange` handler.**

## Three findings that corroborate it

- **WebKit deliberately exempts PiP from its hidden-document block.**
  `HTMLMediaElement.cpp:7786`:
  ```cpp
  if (element.document().hidden() && mode != HTMLMediaElementEnums::VideoFullscreenModePictureInPicture) {
      ALWAYS_LOG(… " returning because document is hidden");
      return;
  }
  ```
  Every other presentation mode is refused from a hidden document; PiP is carved
  out. Entering PiP *because* the document went hidden is a supported path by
  design, not something we are sneaking past.
- **Even without the permanent removal there is a window.**
  `Document::mediaUserGestureReason()` has several true-paths including
  `hasTransientActivation()`, whose default is 5 s (`LocalDOMWindow.cpp`).
- **We are on the permissive entry point, and partly by luck.**
  `requestPictureInPicture()` is *stricter*:
  `HTMLVideoElementPictureInPicture.cpp:118` keys on raw `hasTransientActivation()`
  with **no** first-gesture escape hatch and rejects with `NotAllowedError`.
  `src/core/presentation.ts` uses `webkitSetPresentationMode`.
  **Do not "modernise" that call.** It would break auto-PiP and it is the kind of
  change that looks like tidying.

## The consequence for T10's muted rule

The one case where the gate is still shut is a video that **autoplayed muted and
was never touched** — no gesture ever reached `play()`, so the restriction was
never stripped. That is *precisely* the case T10's `muted` exclusion already
declines to act on. The predicate and the platform's own precondition are nearly
the same set, which makes the muted exclusion **structurally load-bearing rather
than a taste call** — a much better reason than the correlation it was originally
argued from.

One pedantic limit: "playing and not muted implies a gesture happened" is true by
default, not universally. A user with *Allow All Auto-Play* set, or a video with no
audio track, can be playing unmuted without one.

## How the first version of this file got it wrong

Worth more than the fact, because the same trap is still there:

1. **I stopped at the two files that named the symbols I was searching for.**
   `HTMLVideoElement.cpp` and `MediaElementSession.cpp` both matched
   `RequireUserGestureForFullscreen` and told a complete-looking story. The file
   that reverses it, `HTMLMediaElement.cpp`, is **399 KB** — and **GitHub code
   search silently skips files that large**, so it never appeared in the results.
   A search that quietly omits the decisive file is indistinguishable from a search
   that found everything.
2. **I treated "I cannot find the relaxation" as "there is no relaxation"**, and
   then handed the owner a check to run. Absence of evidence in a truncated search
   is not evidence of absence.
3. **The fix that worked** was fetching the whole file and grepping it locally
   rather than searching the host. Do that for WebKit questions: `curl` the raw
   file, then grep. It is one command and it does not lie about coverage.
