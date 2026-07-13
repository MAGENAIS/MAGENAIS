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

**Sizing:** images are shown with `background-size: cover` across the full
width of the bar, so they always read as a proper full-width banner rather
than a small centered thumbnail. If your source image has a lot of empty
padding around the actual logo/content (ours did — cropped out here),
crop it down to just the content first for the best result; a wide, short
image (roughly 4:1 to 10:1) fits both bars best.

**Format:** PNG or JPG. A transparent PNG works well since the app already
darkens/blurs behind the header text for legibility.
