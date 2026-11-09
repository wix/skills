# Default Videos

Use this reference to choose Wix-hosted defaults for `Video` props and item
fields. `COMPONENT-CONTRACT.md` owns the media types.

Choose how many items the design needs first; never reduce the count to fit
the pool. Give every video slot a default; never leave one empty. Fill slots
in order:

1. Rows whose tags match the component's purpose.
2. When those run out, or none match, the `general` rows not used yet: 1, 2,
   3, then 9. A portrait (tall) slot uses row 11 first.
3. When those run out too, repeat the videos already used, in the same order.

Build each `Video` from its row, where `<id>` is the row's `id`:

```ts
video: {
  uri: '<id>',
  name: '<description>',
  sources: [
    { quality: '1080p', width: 1920, height: 1080, types: [{ format: 'mp4', uri: 'video/<id>/1080p/mp4/file.mp4', url: 'https://video.wixstatic.com/video/<id>/1080p/mp4/file.mp4' }] },
    { quality: '720p', width: 1280, height: 720, types: [{ format: 'mp4', uri: 'video/<id>/720p/mp4/file.mp4', url: 'https://video.wixstatic.com/video/<id>/720p/mp4/file.mp4' }] },
    { quality: '480p', width: 854, height: 480, types: [{ format: 'mp4', uri: 'video/<id>/480p/mp4/file.mp4', url: 'https://video.wixstatic.com/video/<id>/480p/mp4/file.mp4' }] },
  ],
  adaptiveSources: [],
  hasAudio: <Audio>, // the row's Audio: yes → true, no → false
  fps: <fps>, // the row's fps, for example 25 or 29.97
  poster: { url: 'https://static.wixstatic.com/media/<id>f000.jpg', uri: '<id>f000.jpg', alt: '<description>' },
},
```

Rows 1–10 are landscape 16:9. Row 11 is portrait 9:16, so swap each source's
`width` and `height` (1080×1920, 720×1280, 480×854). Every row has all three
qualities.

| # | `id` | Description | Tags | fps | Audio |
| --- | --- | --- | --- | --- | --- |
| 1 | `11062b_3ed986e7d4664b70aa563423352c130f` | Slow silver-blue liquid flowing | general, abstract | 30 | no |
| 2 | `11062b_95d34f15761e4114a57b17823228948e` | Calm turquoise sea meeting a pale horizon | general, travel | 25 | no |
| 3 | `11062b_240ceadfce144953be3b55434db78e92` | City skyline under moving clouds | general, business, travel | 29.97 | no |
| 4 | `11062b_4340bbcd93f14d92b07da0b006fc5f43` | Overhead view of a team working at office desks | business, people | 23.98 | no |
| 5 | `11062b_fc9c95ad7e20472ca5b659bd7bc733f1` | Close-up of hands typing on a laptop | technology, business | 29.97 | no |
| 6 | `11062b_747374b1b7ad4177a223dd27c48744f0` | Espresso pouring from a machine into a cup | food | 25 | no |
| 7 | `11062b_4c690d1e50374328b50959824c096892` | Woman doing yoga on seaside rocks | wellness, people, travel | 25 | no |
| 8 | `11062b_0390282a577b48878a4ccf467c504b76` | Amber cosmetic bottles on a beige set | product, beauty | 24 | no |
| 9 | `11062b_c7885953166e4f55b673c272bdbec6d5` | Soft leaf shadows moving on a pale wall | general, home, wellness | 25 | no |
| 10 | `11062b_953b517691e34052afc53ccacc33fc67` | Minimalist living room seen through wooden slats | home | 24 | no |
| 11 | `11062b_2b2bc293460348e28f436fd15591a7f4` | Violet ink swirling in water, portrait 9:16 | general, abstract | 25 | no |
