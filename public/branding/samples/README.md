# Header / footer banner images

MAGENAIS's top bar and footer can each show a full-width banner image
behind their text/buttons. To use your own:

1. Replace `public/branding/banner.png` with your header banner image.
2. Replace `public/branding/footer-banner.png` with your footer banner image.
3. Rebuild (`npm run build`) or just refresh in dev mode — no code changes
   needed.

Two working examples (the ones shown by default) are kept here in
`samples/` — `sample-header-banner.png` and `sample-footer-banner.png` —
so you always have a known-good pair to fall back to or compare against.

**Sizing:** images are shown with `background-size: contain` (not
`cover`), so your whole image is always visible, uncropped, letterboxed
against the theme background if its aspect ratio doesn't exactly match the
bar it sits in. There's no required size — a wide, short banner (roughly
3:1 to 10:1) works best since that's the shape of both bars, but any
image works.

**Format:** PNG or JPG. A transparent PNG works well since the app already
darkens/blurs behind the header text for legibility.
